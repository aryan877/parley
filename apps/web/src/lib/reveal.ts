import { useNavigate } from "react-router-dom";

const TOP_BAR = 84;

/** Opens a page and scrolls one part of it into view once it has rendered. */
export function useOpenAt() {
  const navigate = useNavigate();
  return (path: string, selector: string) => {
    navigate(path);
    const until = Date.now() + 4000;
    const look = () => {
      const target = document.querySelector(selector);
      if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - TOP_BAR, behavior: "smooth" });
      else if (Date.now() < until) setTimeout(look, 150);
    };
    setTimeout(look, 250);
  };
}
