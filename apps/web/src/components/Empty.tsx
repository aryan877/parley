import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Mascot, type Mood } from "./Mascot.tsx";

/** A friendly empty state: a coin character, one short line, and what to do next. */
export function Empty({ id, mood = "idle", title, children, action }: { id: string; mood?: Mood; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}>
        <Mascot id={id} size={76} mood={mood} />
      </motion.div>
      <div className="empty-text">
        <h3>{title}</h3>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}
