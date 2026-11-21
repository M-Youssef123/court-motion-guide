import { createFileRoute, redirect } from "@tanstack/react-router";

// Serve Coach is a static app in public/serve-coach; / sends visitors straight to it.
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Serve Coach — record and replay your tennis serve" },
      { name: "description", content: "Record your serve, replay it with a skeleton overlay and save clips to your phone." },
      { property: "og:title", content: "Serve Coach" },
      { property: "og:description", content: "Record your serve, replay it with a skeleton overlay and save clips to your phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ href: "/serve-coach/index.html" });
  },
});
