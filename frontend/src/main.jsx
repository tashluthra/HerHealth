import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css"; // keep if you’re using Tailwind or base CSS

const el = document.getElementById("root");
createRoot(el).render(<App />);
