"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { pushEscape } from "@/lib/escapeStack"

/**
 * Wrapper around base-ui's Dialog.Root that also registers the
 * dialog with our app-wide escape stack while it's open. base-ui's
 * built-in ESC handling closes the popup, but it doesn't reliably
 * stop native propagation — so without this registration the global
 * ESC handler in App.tsx would fire on the same keystroke and could
 * escalate to hideApp(). LIFO stack semantics also make nested
 * dialogs (e.g. a confirm popup over the settings dialog) close in
 * the right order without each component knowing about the others.
 *
 * See `plans/escape-stack-audit.md`.
 */
function Dialog({ open, onOpenChange, ...props }: DialogPrimitive.Root.Props) {
  React.useEffect(() => {
    if (!open) return
    // base-ui's onOpenChange has overloads with optional event/reason
    // params; passing just `false` is allowed and matches the runtime
    // call shape base-ui itself uses for ESC dismissals.
    return pushEscape(() => (onOpenChange as ((open: boolean) => void) | undefined)?.(false))
  }, [open, onOpenChange])
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={open}
      onOpenChange={onOpenChange}
      {...props}
    />
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Dialog width SSOT — see `plans/ssot-index.md` §A.17.
 *
 * One of these tokens, not a hand-rolled pixel count, should be the
 * source of every dialog's width. Sizes were calibrated against the
 * existing 9-call inventory at 2026-05-14:
 *   sm  — confirm / single-action prompts (e.g. "취소할까요?")
 *   md  — wizard steps, picker dialogs, settings sub-dialogs
 *   lg  — list + detail (ScanDialog, DocCohortDialog with options)
 *   xl  — full editors (ItemDialog with all tabs)
 *
 * Callers pass `size="md"` instead of `style={{ width: 440 }}`. The
 * 92 vw cap mirrors the historic inline pattern so very narrow viewports
 * stay reasonable. Inline `style.width` is honoured for ad-hoc cases
 * (passes through via spread) but flagged by the anti-pattern grep —
 * pick a token if at all possible. */
export const DIALOG_SIZE = {
  sm: 360,
  md: 440,
  lg: 520,
  xl: 640,
} as const;

export type DialogSize = keyof typeof DIALOG_SIZE;

function DialogContent({
  className,
  children,
  size,
  showCloseButton = true,
  style,
  ...props
}: DialogPrimitive.Popup.Props & {
  size?: DialogSize
  showCloseButton?: boolean
}) {
  // size-driven width: the token is the *target*, maxWidth lets the
  // dialog shrink when the user's nost main window is narrow (pair-
  // split layout, side-by-side multitasking), and minWidth keeps the
  // contents from collapsing past the legibility floor — at ~320px
  // header / body / button rows still lay out cleanly. If the parent
  // viewport is smaller than minWidth (rare, very narrow window) the
  // dialog will overflow into the screen, which is preferable to
  // contents truncating onto multiple awkward lines.
  const sizeStyle = size ? {
    width: DIALOG_SIZE[size],
    maxWidth: '95vw' as const,
    minWidth: Math.min(DIALOG_SIZE[size], 320),
  } : undefined;
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // Back-compat: callers that haven't migrated to `size` still
          // need a reasonable bound so they don't shrink to nothing.
          // The 384px max stayed until v1.3.34 — it's the source of the
          // DocCohortDialog squeeze bug. Drop it the moment all 9 sites
          // adopt `size`.
          !size && "w-full max-w-[calc(100%-2rem)] sm:max-w-sm",
          className
        )}
        style={sizeStyle ? { ...sizeStyle, ...style } : style}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
