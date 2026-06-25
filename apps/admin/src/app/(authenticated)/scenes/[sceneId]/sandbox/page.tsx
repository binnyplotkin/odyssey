import Link from "next/link";
import { notFound } from "next/navigation";
import { getSceneStore } from "@odyssey/db";
import { SceneSandbox } from "@/components/scene-sandbox";
import { SceneVoiceSandbox } from "@/components/scene-voice-sandbox";
import { adminTokens } from "@/components/admin-ui";
import { resolveScene } from "@/lib/scene-orchestration";

export const dynamic = "force-dynamic";

// When the LiveKit voice agent is on, scene rehearsal runs over a real-time room
// (the SceneDriver) instead of the browser SSE/orchestrate path.
const VOICE_AGENT_ENABLED = process.env.NEXT_PUBLIC_VOICE_AGENT === "1";

export default async function SceneSandboxPage({
  params,
}: {
  params: Promise<{ sceneId: string }>;
}) {
  const { sceneId } = await params;

  const record = await getSceneStore().getSceneById(sceneId);
  if (!record) notFound();

  const scene = await resolveScene(sceneId);

  if (!scene || scene.characters.length === 0) {
    return (
      <div
        style={{
          padding: "var(--space-32) 40px",
          background: adminTokens.bg,
          color: adminTokens.fg,
          fontFamily: adminTokens.fontBody,
          minHeight: "calc(100vh - 48px)",
        }}
      >
        <Link
          href={`/scenes/${sceneId}`}
          style={{
            color: adminTokens.muted,
            fontFamily: adminTokens.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          ← {record.title}
        </Link>
        <p style={{ marginTop: "var(--space-16)", color: adminTokens.muted }}>
          This scene has no cast yet. Add at least one character in the{" "}
          <Link href={`/scenes/${sceneId}`} style={{ color: adminTokens.accent }}>
            scene editor
          </Link>{" "}
          before rehearsing.
        </p>
      </div>
    );
  }

  return VOICE_AGENT_ENABLED ? (
    <SceneVoiceSandbox sceneId={sceneId} sceneTitle={record.title} scene={scene} />
  ) : (
    <SceneSandbox sceneId={sceneId} sceneTitle={record.title} scene={scene} />
  );
}
