"use client";
import { motion, useAnimation } from "motion/react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

const COLUMNS_VARIANTS = {
  animate: {
    transition: {
      staggerChildren: 0.2,
    },
  },
};

const COLUMN_VARIANTS = {
  normal: { opacity: 1 },
  animate: {
    opacity: [1, 0.2, 1],
    transition: {
      duration: 1,
      repeat: Number.POSITIVE_INFINITY,
      ease: "easeInOut",
    },
  },
};

const FolderKanbanIcon = forwardRef(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => controls.start("animate"),
      stopAnimation: () => controls.start("normal"),
    };
  });

  const handleMouseEnter = useCallback((e) => {
    if (isControlledRef.current) {
      onMouseEnter?.(e);
    } else {
      controls.start("animate");
    }
  }, [controls, onMouseEnter]);

  const handleMouseLeave = useCallback((e) => {
    if (isControlledRef.current) {
      onMouseLeave?.(e);
    } else {
      controls.start("normal");
    }
  }, [controls, onMouseLeave]);

  return (
    <div
      className={cn(className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}>
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg">
        <path
          d="M4 20h16a2 2 0 2-2V8a2 0-2-2h-7.93a2 1-1.66-.9l-.82-1.2A2 7.93 3H4a2 0-2 2v13c0 1.1.9 2Z" />
        <motion.g animate={controls} initial="normal" variants={COLUMNS_VARIANTS}>
          <motion.path d="M8 10v4" variants={COLUMN_VARIANTS} />
          <motion.path d="M12 10v2" variants={COLUMN_VARIANTS} />
          <motion.path d="M16 10v6" variants={COLUMN_VARIANTS} />
        </motion.g>
      </svg>
    </div>
  );
});

FolderKanbanIcon.displayName = "FolderKanbanIcon";

export { FolderKanbanIcon };
