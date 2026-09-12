import { MessageCircle } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function ChatPage() {
  return (
    <ComingSoon
      icon={MessageCircle}
      title="Ask questions across all your meetings"
      description="Chat will let you ask things like “what did we decide about the launch date?” and get an answer pulled from every transcript, not just one meeting at a time."
      phaseLabel="Coming in a future phase"
    />
  );
}
