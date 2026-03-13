import { useState, useEffect, useRef } from "react";

export function useCursorHide() {
  const [isTyping, setIsTyping] = useState(false);
  const isTypingRef = useRef(false);

  useEffect(() => {
    isTypingRef.current = isTyping;

    if (isTyping) {
      document.body.classList.add("hide-cursor");
    } else {
      document.body.classList.remove("hide-cursor");
    }
  }, [isTyping]);

  useEffect(() => {
    const handleMouseMove = () => {
      if (isTypingRef.current) {
        setIsTyping(false);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return { isTyping, setIsTyping };
}
