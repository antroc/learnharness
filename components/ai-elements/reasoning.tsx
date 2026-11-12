"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";

import { transformMathDelimiters } from "@/src/core";
import { streamdownPlugins, streamdownRehypePlugins, streamdownRemend } from "./message";
import { mdComponents } from "@/components/md-blocks";
import { Shimmer } from "./shimmer";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const AUTO_CLOSE_DELAY = 1000;

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    children,
    ...props
  }: ReasoningProps) => {
    // PLEGADO POR DEFECTO, SIEMPRE (responsable, ronda de streaming 2026-10-01):
    // el antiguo valor por defecto se abría durante el streaming y un efecto de apertura
    // automática volvía a pelearse con un plegado manual: el bloque «no se podía plegar
    // hasta que terminaba». Plegado es el valor por defecto; abrirlo es siempre un
    // clic del alumno; el cierre automático tras el stream sigue ordenando una
    // fila que el alumno hubiera abierto.
    const resolvedDefaultOpen = defaultOpen ?? false;

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: open,
    });
    const hasEverStreamedRef = useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);

    // Cierre automático al terminar el streaming (una sola vez, y solo si llegó a haber streaming)
    useEffect(() => {
      if (
        hasEverStreamedRef.current &&
        !isStreaming &&
        isOpen &&
        !hasAutoClosed
      ) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        setIsOpen(newOpen);
      },
      [setIsOpen]
    );

    const contextValue = useMemo(
      () => ({ isOpen, isStreaming, setIsOpen }),
      [isOpen, isStreaming, setIsOpen]
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean) => ReactNode;
};

/* La etiqueta asentada (ronda del responsable, 2026-10-05): "Agent's thinking"
   estático; la duración era estado del turno en vivo que de todos modos moría al
   remontar («pensó durante unos segundos»), contabilidad de una información que
   sabemos que perdemos. La etiqueta forma pareja con las filas plegadas
   "Your thinking" del usuario: un solo lenguaje; el movimiento (spinner +
   brillo) sigue siendo la señal de trabajo. */
const defaultGetThinkingMessage = (isStreaming: boolean) => {
  if (isStreaming) {
    return <Shimmer duration={1}>Thinking...</Shimmer>;
  }
  return <p>AGENT’S THINKING</p>;
};

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          /* El registro de encabezado (ronda 4 del responsable, 2026-10-05): las pequeñas
             versalitas mono de los antetítulos de las tarjetas, a juego con YOUR THINKING,
             cuyo raíl lo desplaza exactamente la diferencia de un carácter. */
          "flex w-full items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide transition-colors hover:text-foreground",
          className
        )}
        {...props}
        /* HIGIENE DEL FOCO (responsable, ronda de teclado 2026-10-10): un clic de puntero
           en el conmutador del razonamiento no debe dejar el foco aquí; el siguiente
           Enter del alumno envía, no debe volver a conmutar. Radix lo compone con su
           propio manejador del conmutador. */
        onClick={(e) => blurAfterPointerClick(e)}
      >
        {children ?? (
          <>
            {/* La gramática del estado de trabajo (responsable, ronda de streaming
                2026-10-01): el spinner Braille sustituye al icono del cerebro SOLO
                DURANTE EL STREAMING; el movimiento es la señal, así que una fila
                terminada no lleva ningún icono, solo texto + chevron. Tamaño: el
                valor por defecto del componente (h-3), IDÉNTICO al spinner provisional
                (responsable, 2026-10-02): el traspaso entre ambos estados debe ser
                visualmente imperceptible, un único tamaño en todas partes. */}
            {isStreaming && <BrailleSpinner label="Thinking" />}
            {getThinkingMessage(isStreaming)}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  }
);

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string;
};

// Comparte la configuración de Streamdown de message.tsx (delimitadores matemáticos, mermaid
// oscuro, remark-breaks): el razonamiento renderiza con el mismo contrato que el texto del mensaje.

export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-4 text-sm",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      <Streamdown components={mdComponents} plugins={streamdownPlugins} rehypePlugins={streamdownRehypePlugins} remend={streamdownRemend}>
        {transformMathDelimiters(children)}
      </Streamdown>
    </CollapsibleContent>
  )
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
