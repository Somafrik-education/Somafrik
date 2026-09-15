const showDemoAccounts = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === "true";

const marketplaceEnabled = import.meta.env.VITE_ENABLE_MARKETPLACE === "true";

const publicDemoEnabled = import.meta.env.VITE_ENABLE_PUBLIC_DEMO === "true";

const demoRuntimeEnabled = import.meta.env.VITE_DEMO_RUNTIME === "true";

export { showDemoAccounts, marketplaceEnabled, publicDemoEnabled, demoRuntimeEnabled };
