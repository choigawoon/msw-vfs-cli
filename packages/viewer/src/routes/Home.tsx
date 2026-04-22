import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Layers, Box } from "lucide-react";

export function Home() {
  const [clicks, setClicks] = useState(0);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      <div className="flex items-center gap-3">
        <Layers className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">
          MSW VFS Viewer
        </h1>
      </div>
      <p className="text-muted-foreground max-w-md text-center">
        Desktop viewer for MapleStory Worlds{" "}
        <code className="font-mono">.map</code> /{" "}
        <code className="font-mono">.ui</code> /{" "}
        <code className="font-mono">.model</code> assets. VFS integration
        coming next.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => setClicks((n) => n + 1)}>
          <FileText className="mr-2 h-4 w-4" />
          Open File ({clicks})
        </Button>
        <Button variant="outline">
          <Box className="mr-2 h-4 w-4" />
          About
        </Button>
      </div>
    </main>
  );
}
