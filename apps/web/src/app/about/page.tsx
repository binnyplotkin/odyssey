import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { GoogleAuthButton } from "@/components/google-auth-button";

export const metadata: Metadata = {
  title: "About — Odyssey",
  description:
    "Odyssey is an immersive reality engine that opens the door to infinite worlds — reshaping how people learn, create, and experience life.",
};

const heading = "var(--font-heading)";
const mono = "var(--font-mono)";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white" style={{ fontFamily: "var(--font-body)" }}>
      {/* ── Hero ── */}
      <section className="relative min-h-[85vh] overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/infinite-worlds.png"
            alt="An expansive vista of infinite worlds — luminous landscapes, floating realms, and vast possibilities stretching to the horizon"
            fill
            className="object-cover"
            priority
            quality={90}
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a]/90 via-black/30 to-black/45" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent" />
        </div>

        <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10 lg:px-20">
          <Link href="/" className="flex items-center gap-2">
            <svg width="40" height="18" viewBox="0 0 1253 552" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M546.047 167.264C536.748 173.082 520.508 183.309 512.311 189.963C578.447 158.716 640.463 131.927 712.011 112.485C789.513 91.6036 872.254 73.6171 952.815 78.6919C1009 82.2315 1023.71 106.767 977.448 145.978C918.626 195.839 844.995 233.131 775.316 265.992C668.19 315.561 558.614 359.662 447.015 398.124C423.46 406.475 399.821 414.589 376.104 422.467C365.211 426.068 350.785 431.209 339.929 433.914C349.11 429.416 362.505 424.319 372.352 420.133L436.916 392.495C497.647 366.373 558.05 339.497 618.113 311.872L617.721 310.725C556.842 336.257 495.27 360.113 433.078 382.264C415.881 388.481 398.615 394.504 381.282 400.333C372.764 403.239 357.321 408.775 348.761 410.515C394.029 390.182 437.861 371.218 482.997 349.87L481.608 348.6C401.07 383.238 319.612 415.695 237.322 445.937C211.986 455.356 186.565 464.549 161.065 473.515C151.192 476.989 131.532 484.336 121.938 486.82L123.286 488.059C144.465 481.397 167.846 475.355 189.349 469.152C224.934 458.783 260.348 447.835 295.577 436.313C300.048 434.825 304.612 434.009 309.267 432.425C309.34 432.397 309.4 432.376 309.444 432.365C309.385 432.385 309.326 432.405 309.267 432.425C308.39 432.769 305.612 434.269 304.738 434.651C297.707 437.732 290.538 440.322 283.421 443.207L220.921 467.825C147.612 496.268 73.9668 523.836 0 550.523L1.2155 551.713C7.71857 550.248 17.2349 547.162 23.8157 545.257L68.0639 532.447C107.979 521.114 147.982 510.087 188.066 499.368C229.986 487.995 272.003 476.986 314.115 466.343C364.355 453.897 413.647 442.62 463.908 429.408C488.553 422.968 513.112 416.198 537.577 409.101C550.896 405.241 569.354 399.162 582.411 396.39C510.43 430.934 421.953 457.546 345.135 477.587L345.701 478.839C354.186 477.559 369.467 473.83 378.097 471.876C398.096 467.391 418.04 462.668 437.927 457.709C536.288 433.136 637.356 402.314 730.849 362.759L730.464 361.547C684.216 379.574 637.239 395.684 589.663 409.837C571.722 415.289 544.719 424.029 526.568 427.61C565.454 410.989 605.119 397.217 643.09 378.05C654.433 372.323 674.446 366.695 686.973 362.335C707.151 355.294 727.233 347.964 747.205 340.348C838.071 305.741 929.378 264.953 1013.32 215.832C1036.47 202.285 1332.77 16.0042 1231.67 2.96727C1194.12 -1.87509 1145.87 0.366926 1108 1.66091C929.963 7.74303 768.93 45.978 611.086 129.472C588.954 141.273 567.26 153.879 546.047 167.264Z" fill="white"/>
            </svg>
            <span className="text-xl font-bold tracking-tight" style={{ fontFamily: heading }}>
              Odyssey
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <GoogleAuthButton />
          </div>
        </header>

        <div className="relative z-10 flex min-h-[75vh] flex-col justify-end px-6 pb-16 sm:px-10 lg:px-20">
          <div className="max-w-2xl space-y-5">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/50"
              style={{ fontFamily: mono }}
            >
              The Vision
            </p>
            <h1
              className="text-4xl font-semibold leading-[1.1] sm:text-5xl lg:text-[56px]"
              style={{ fontFamily: heading, letterSpacing: "-0.04em" }}
            >
              <span className="text-[#8fd1cb]">Infinite Worlds.</span>
              <br />
              One Engine.
              <br />
              Limitless Potential.
            </h1>
            <p className="max-w-lg text-[15px] leading-relaxed text-white/60">
              Odyssey is an immersive reality engine that opens the door to
              every world imaginable — and builds the ones that haven&apos;t been imagined yet.
            </p>
          </div>
        </div>
      </section>

      {/* ── Article ── */}
      <section className="bg-[#0a0a0a]">
        <div className="mx-auto w-full max-w-[720px] px-6 sm:px-10 lg:px-0">

          {/* I. The Idea */}
          <div className="space-y-6 pt-[120px]">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              I. The Idea
            </p>
            <h2
              className="text-3xl font-semibold tracking-[-0.03em] sm:text-[40px] sm:leading-[1.15]"
              style={{ fontFamily: heading }}
            >
              A Door Into Every World
            </h2>
            <div className="space-y-5 text-[17px] leading-[1.7] text-white/65">
              <p>
                Odyssey began with a deceptively simple premise: what if technology could place you — fully, convincingly, consequentially — inside any world you could describe?
              </p>
              <p>
                Not a game with predefined outcomes. Not a simulation with guardrails. A living, adaptive environment that responds to your choices with the depth and unpredictability of reality itself. A medieval court where your diplomacy has real political consequences. A deep-sea expedition where every decision reshapes the mission. A jazz club in 1940s Harlem where the music shifts with the room.
              </p>
            </div>
            <blockquote
              className="rounded-2xl border border-white/8 bg-white/[0.03] px-8 py-6 text-[22px] font-medium italic leading-[1.5]"
              style={{ fontFamily: heading, color: "#8fd1cb" }}
            >
              &ldquo;The most powerful technology disappears. What remains is the experience.&rdquo;
            </blockquote>
            <p className="text-[17px] leading-[1.7] text-white/65">
              That conviction — that the technology should vanish behind the world it creates — became the founding principle of Odyssey. Every architectural decision, every model integration, every interface choice flows from it.
            </p>
          </div>

          {/* The Engine Card */}
          <div className="mt-20 rounded-3xl border border-white/8 bg-white/[0.03] p-8 sm:p-10">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              The Engine
            </p>
            <h3
              className="mt-4 text-2xl font-semibold tracking-[-0.02em] sm:text-[28px] sm:leading-[1.2]"
              style={{ fontFamily: heading }}
            >
              Worlds That Think, Adapt, and Respond
            </h3>
            <div className="mt-4 space-y-4 text-[15px] leading-[1.7] text-white/60">
              <p>
                At the core of Odyssey is an immersive reality engine capable of generating, maintaining, and evolving entire worlds in real time. It holds persistent memory of characters, environments, and consequences. It adapts narratives to your decisions without breaking coherence.
              </p>
              <p>
                The engine is built on advances in large-scale language models, real-time state management, and adaptive narrative architecture — technologies that simply did not exist at this level of maturity until now.
              </p>
            </div>
          </div>

          {/* II. The Opportunity */}
          <div className="space-y-5 pt-[120px]">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              II. The Opportunity
            </p>
            <h2
              className="text-3xl font-semibold tracking-[-0.03em] sm:text-[40px] sm:leading-[1.15]"
              style={{ fontFamily: heading }}
            >
              What Infinite Worlds Unlock
            </h2>
            <p className="text-[17px] leading-[1.7] text-white/65">
              When you can step into any world with full consequence and fidelity, entirely new categories of value emerge — across entertainment, education, professional development, and human understanding.
            </p>
          </div>
        </div>

        {/* Use Cases — full width for 3-col */}
        <div className="mx-auto mt-12 grid max-w-[1280px] gap-5 px-6 sm:px-10 md:grid-cols-3 lg:px-20">
          <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-8">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              Dimension I
            </p>
            <h3
              className="mt-3 text-lg font-semibold tracking-[-0.01em]"
              style={{ fontFamily: heading }}
            >
              Experiential Understanding
            </h3>
            <p className="mt-1 text-xs italic text-white/40">Know It by Living It</p>
            <p className="mt-4 text-sm leading-relaxed text-white/55">
              Experiential understanding transforms preparation into reality. Imagine someone who wants to overcome their fear of public speaking or sharpen their ability to communicate under pressure. Instead of rehearsing alone, they step into a simulation where they are presenting in front of a live audience that reacts in real time—showing engagement, boredom, judgment, or approval through realistic emotional responses. They can practice in different environments, from job interviews to high-stakes presentations in front of judges, and even control the difficulty of the room—whether it&apos;s a supportive audience or a critical panel designed to challenge them.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/55">
              Today, this experience begins through advanced audio-based interaction, but the vision extends far beyond. With full VR integration, users will stand inside lifelike environments surrounded by human avatars that express emotion through facial expressions, tone, and body language—making the experience feel indistinguishable from reality. Through repeated exposure in these immersive scenarios, fear begins to dissolve, confidence becomes natural, and communication transforms into a mastered skill rather than a source of doubt.
            </p>
          </div>

          <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-8">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              Dimension II
            </p>
            <h3
              className="mt-3 text-lg font-semibold tracking-[-0.01em]"
              style={{ fontFamily: heading }}
            >
              High-Fidelity Preparation
            </h3>
            <p className="mt-1 text-xs italic text-white/40">Rehearsal at the Speed of Reality</p>
            <p className="mt-4 text-sm leading-relaxed text-white/55">
              High-fidelity preparation turns practice into measurable performance. Surgeons rehearse before operating. Pilots train before flying. Odyssey extends that same principle to communication, leadership, negotiation, and crisis response through realistic simulation loops that let users fail safely, adjust quickly, and improve with intent.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/55">
              As users move from Dimension I&apos;s emotional realism into repeatable high-pressure drills, they build not only confidence but consistency. The result is readiness that transfers beyond the simulation and into real-world decision-making.
            </p>
          </div>

          <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-8">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              Dimension III
            </p>
            <h3
              className="mt-3 text-lg font-semibold tracking-[-0.01em]"
              style={{ fontFamily: heading }}
            >
              Creative & Narrative Innovation
            </h3>
            <p className="mt-1 text-xs italic text-white/40">Stories You Don&apos;t Watch — You Inhabit</p>
            <p className="mt-4 text-sm leading-relaxed text-white/55">
              Creative and narrative innovation allows users to build entirely new worlds from knowledge itself. Imagine a history teacher who wants her students to truly understand the era of Napoleon. Instead of relying solely on lectures and textbooks, she gathers everything available—historical documents, lesson plans, primary sources—and feeds it into the system. From that, she creates a fully immersive world where Napoleon himself guides the student through his time period, walking them through key events, decisions, and environments as if they were living inside history.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/55">
              Every piece of knowledge that would normally be studied for a test is embedded directly into the experience. To progress through the simulation, students must remember and apply what they’ve learned, unlocking new parts of the world as they demonstrate understanding. The result is not just memorization, but true comprehension—where education becomes an interactive journey, and learning feels like living through the story rather than reading about it.
            </p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[720px] px-6 sm:px-10 lg:px-0">

          {/* The First Worlds */}
          <div className="space-y-5 pt-[120px]">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              Where It Began
            </p>
            <h2
              className="text-3xl font-semibold tracking-[-0.03em] sm:text-[40px] sm:leading-[1.15]"
              style={{ fontFamily: heading }}
            >
              The First Worlds
            </h2>
            <p className="text-[17px] leading-[1.7] text-white/65">
              Before the engine, before the architecture — there were two questions asked on a rock in Central Park that set everything in motion.
            </p>
          </div>
        </div>

        {/* Origin Cards — wider */}
        <div className="mx-auto mt-12 grid max-w-[1200px] gap-5 px-6 sm:grid-cols-2 sm:px-10 lg:px-20">
          <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-8 sm:p-10">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              World I
            </p>
            <h3
              className="mt-3 text-xl font-semibold tracking-[-0.02em] sm:text-2xl"
              style={{ fontFamily: heading }}
            >
              What Would It Feel Like to Be a King?
            </h3>
            <div className="mt-4 space-y-3 text-sm leading-[1.7] text-white/55">
              <p>
                Not a figurehead. Not a character in a game. A real king — burdened by the weight of a crown, surrounded by advisors whose loyalty you can never quite verify, responsible for thousands of lives shaped by every decision you make.
              </p>
              <p>
                The loneliness at the top of the tower. The impossible calculus of mercy versus order. The moment you realize the throne doesn&apos;t grant wisdom — it demands it.
              </p>
              <p className="text-[13px] italic text-[#8fd1cb]">
                This was the first question. The one that cracked the door open.
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-8 sm:p-10">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              World II
            </p>
            <h3
              className="mt-3 text-xl font-semibold tracking-[-0.02em] sm:text-2xl"
              style={{ fontFamily: heading }}
            >
              What Would It Feel Like to Be a Pirate?
            </h3>
            <div className="mt-4 space-y-3 text-sm leading-[1.7] text-white/55">
              <p>
                Salt air. A crew that follows you only as long as you&apos;re worth following. A horizon that promises nothing and everything at once. The raw, ungoverned freedom of a life lived outside every structure the world tried to put you in.
              </p>
              <p>
                The thrill of the chase. The code that only matters when you choose to honor it. The discovery that freedom without purpose is just drift.
              </p>
              <p className="text-[13px] italic text-[#8fd1cb]">
                This was the second question. The one that proved the first wasn&apos;t a fluke.
              </p>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-[720px] px-6 text-center text-[15px] leading-[1.7] text-white/45 sm:px-10 lg:px-0">
          Two worlds. Two very different lives. But the same underlying revelation: the technology to make this real would change everything. Odyssey is the proof.
        </p>

        <div className="mx-auto w-full max-w-[720px] px-6 sm:px-10 lg:px-0">

          {/* III. The Founders */}
          <div className="space-y-3 pt-[120px]">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              III. The Team
            </p>
            <h2
              className="text-3xl font-semibold tracking-[-0.03em] sm:text-[40px] sm:leading-[1.15]"
              style={{ fontFamily: heading }}
            >
              The Founders
            </h2>
            <p className="text-[17px] leading-[1.7] text-white/55">
              Two builders with the vision to see what&apos;s possible and the resolve to make it real.
            </p>
          </div>
        </div>

        {/* Founder Cards */}
        <div className="mx-auto mt-12 grid max-w-[1200px] gap-5 px-6 sm:grid-cols-2 sm:px-10 lg:px-20">
          <div className="overflow-hidden rounded-3xl border border-white/8 bg-white/[0.03]">
            <div className="relative aspect-[5/4] overflow-hidden">
              <Image
                src="/founders-binny-2026-v2.png"
                alt="Binny Plotkin, Co-founder of Odyssey"
                fill
                className="object-cover"
                style={{ objectPosition: "center 34%", filter: "brightness(0.84) saturate(0.95)" }}
              />
            </div>
            <div className="space-y-2 p-8">
              <p
                className="text-[10px] uppercase tracking-[0.25em] text-white/40"
                style={{ fontFamily: mono }}
              >
                Co-founder
              </p>
              <h3
                className="text-[22px] font-semibold"
                style={{ fontFamily: heading }}
              >
                Binny Plotkin
              </h3>
              <p className="text-sm leading-[1.7] text-white/55">
                A builder and storyteller drawn to the intersection of technology, mythology, and the inner life. His work is rooted in the belief that within each person lives a vast inner infinity — and that the most powerful experiences help us return to it.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/8 bg-white/[0.03]">
            <div className="relative aspect-[5/4] overflow-hidden">
              <Image
                src="/founders-josh-2026-v2.png"
                alt="Josh Sassoon, Co-founder of Odyssey"
                fill
                className="object-cover"
                style={{ objectPosition: "center 11%", filter: "brightness(0.84) saturate(0.95)" }}
              />
            </div>
            <div className="space-y-2 p-8">
              <p
                className="text-[10px] uppercase tracking-[0.25em] text-white/40"
                style={{ fontFamily: mono }}
              >
                Co-founder
              </p>
              <h3
                className="text-[22px] font-semibold"
                style={{ fontFamily: heading }}
              >
                Josh Sassoon
              </h3>
              <p className="text-sm leading-[1.7] text-white/55">
                A builder with an uncommon capacity to hold vision and execution in the same hand. He has a rare instinct for identifying the questions worth asking, and the conviction to pursue them before the path is clear.
              </p>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[720px] px-6 sm:px-10 lg:px-0">

          {/* IV. Why Now */}
          <div className="space-y-6 pt-[120px]">
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-white/40"
              style={{ fontFamily: mono }}
            >
              IV. The Moment
            </p>
            <h2
              className="text-3xl font-semibold tracking-[-0.03em] sm:text-[40px] sm:leading-[1.15]"
              style={{ fontFamily: heading }}
            >
              Why Now
            </h2>
            <div className="space-y-5 text-[17px] leading-[1.7] text-white/65">
              <p>
                For decades, the vision of truly immersive, adaptive worlds existed only in science fiction. The computational infrastructure, the language understanding, the real-time narrative coherence — none of it was technically feasible at scale.
              </p>
              <p>
                That changed. Large language models capable of holding entire worlds in memory, generating coherent consequence and dialogue, and adapting to user choices in real time have reached a threshold of maturity that makes Odyssey not just possible — but inevitable.
              </p>
              <p>
                The appetite for this kind of experience is ancient and universal. The technology is finally here. Odyssey exists at the precise intersection of the two — and the market it opens is as vast as the worlds it creates.
              </p>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-[120px] rounded-3xl border border-white/8 bg-white/[0.03] p-10 text-center sm:p-14">
            <p
              className="text-lg italic text-white/50 sm:text-xl"
              style={{ fontFamily: heading }}
            >
              &ldquo;The only way to discover the limits of the possible is to venture past them into the impossible.&rdquo;
            </p>
            <p
              className="mt-2 text-[10px] uppercase tracking-[0.25em] text-white/30"
              style={{ fontFamily: mono }}
            >
              Arthur C. Clarke
            </p>
            <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-white/45">
              Odyssey is building the door. The worlds are waiting.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-7 py-3 text-sm backdrop-blur-lg transition-all hover:scale-[1.03] hover:border-white/40 hover:bg-white/25"
                style={{ fontFamily: mono }}
              >
                Begin Your Odyssey
                <span className="text-white/60">&rarr;</span>
              </Link>
              <Link
                href="/"
                className="inline-flex items-center rounded-full border border-white/15 bg-white/8 px-7 py-3 text-sm backdrop-blur-md transition-all hover:border-white/30 hover:bg-white/15"
                style={{ fontFamily: mono }}
              >
                Back to Home
              </Link>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mx-auto mt-[120px] flex max-w-[1280px] items-center justify-between border-t border-white/8 px-6 py-12 sm:px-10 lg:px-20">
          <span
            className="text-base font-semibold text-white/60"
            style={{ fontFamily: heading }}
          >
            Odyssey
          </span>
          <span className="text-[13px] text-white/35">
            Built with conviction, not permission.
          </span>
        </footer>
      </section>
    </main>
  );
}
