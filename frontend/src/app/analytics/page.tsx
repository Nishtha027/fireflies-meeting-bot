import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function AnalyticsPage() {
  return (
    <ComingSoon
      icon={BarChart3}
      title="Talk-time and meeting trends"
      description="Analytics will surface things like who talks the most in your meetings, how meeting length trends over time, and how quickly action items get closed out."
      phaseLabel="Coming in a future phase"
    />
  );
}
