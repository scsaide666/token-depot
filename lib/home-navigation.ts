export type HomeDestination = "docs" | "api-reference" | "status" | "about" | "terms" | "privacy" | "sign-in" | "get-started";
export type HomeDialogDestination = Exclude<HomeDestination, "sign-in" | "get-started" | "docs" | "api-reference">;

export const homeNavigation = [
  { label: "Models", destination: "models" },
  { label: "Pricing", destination: "pricing" },
  { label: "Docs", destination: "docs" },
] as const;

export const footerNavigation = [
  { title: "Product", links: [
    { label: "Models", href: "/models" },
    { label: "Pricing", href: "/pricing" },
    { label: "API", href: "#developers" },
  ] },
  { title: "Developers", links: [
    { label: "Documentation", href: "/docs" },
    { label: "API Reference", href: "/docs#chat-completions" },
    { label: "Status", destination: "status" },
  ] },
  { title: "Company", links: [
    { label: "Terms", href: "/terms" },
    { label: "Privacy", href: "/privacy" },
    { label: "Refund Policy", href: "/refund-policy" },
    { label: "Acceptable Use", href: "/acceptable-use" },
    { label: "Contact", href: "/contact" },
  ] },
] as const;

export const destinationDetails: Record<HomeDialogDestination, { title: string; description: string }> = {
  status: { title: "System Status", description: "Service status updates are coming soon." },
  about: { title: "About Token Depot", description: "More about Token Depot is coming soon." },
  terms: { title: "Terms of Service", description: "The terms of service are being prepared." },
  privacy: { title: "Privacy", description: "The privacy policy is being prepared." },
};
