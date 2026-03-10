import { MemorySummarizer } from "@/lib/simulation/interfaces";

export class RollingMemorySummarizer implements MemorySummarizer {
  summarize(previous: string[], addition: string) {
    return [...previous, addition].slice(-6);
  }
}
