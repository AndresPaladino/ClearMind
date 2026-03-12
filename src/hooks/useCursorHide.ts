import { useState, useEffect } from "react";

export function useCursorHide() {
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (isTyping) {
      document.body.classList.add("hide-cursor");
    } else {
      document.body.classList.remove("hide-cursor");
    }
  }, [isTyping]);

  useEffect(() => {
    const handleMouseMove = () => {
      if (isTyping) setIsTyping(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [isTyping]);

  return { isTyping, setIsTyping };
}
