/** True only when Vite is started/built with VITE_PORTFOLIO_DEMO=true. Production builds stay false. */
export const IS_PORTFOLIO_DEMO = import.meta.env.VITE_PORTFOLIO_DEMO === "true";
