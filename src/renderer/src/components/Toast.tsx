import { cn } from "@/lib/utils";
import { XMarkIcon } from "@heroicons/react/20/solid";
import React from "react";

export interface ToastData {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: number) => void;
}

const bgMap: Record<ToastData["type"], string> = {
  success: "bg-green-600/90",
  error: "bg-red-600/90",
  info: "bg-primary/90",
};

const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  return (
    <div
      className={cn(
        bgMap[toast.type],
        "text-white text-sm px-4 py-2.5 rounded-md shadow-lg flex items-center gap-3 min-w-[240px] max-w-[380px] animate-slide-in cursor-pointer",
      )}
      onClick={() => onDismiss(toast.id)}
    >
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        className="text-white/70 hover:text-white transition-colors"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

export default Toast;
