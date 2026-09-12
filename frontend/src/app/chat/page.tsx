"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send, Sparkles } from "lucide-react";
import { ApiError, askChat, embedAll, NetworkError } from "@/lib/api";
import type { ChatSource } from "@/lib/types";
import { ChatSourceChip } from "@/components/ChatSourceChip";

const EXAMPLE_QUESTIONS = [
  "What did we decide about the launch date?",
  "What is Astra?",
  "What are Raj's action items?",
];

interface Exchange {
  id: number;
  question: string;
  status: "loading" | "done" | "error";
  answer?: string;
  sources?: ChatSource[];
  error?: string;
}

let nextId = 1;

function errorMessage(err: unknown): string {
  if (err instanceof NetworkError) return err.message;
  if (err instanceof ApiError) return err.message;
  return "Something went wrong answering that.";
}

export default function ChatPage() {
  const [indexing, setIndexing] = useState(true);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    embedAll().finally(() => {
      if (!cancelled) setIndexing(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [exchanges]);

  function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;

    const id = nextId++;
    setExchanges((prev) => [...prev, { id, question: trimmed, status: "loading" }]);
    setInput("");

    askChat(trimmed)
      .then((data) => {
        setExchanges((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, status: "done", answer: data.answer, sources: data.sources }
              : e,
          ),
        );
      })
      .catch((err) => {
        setExchanges((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, status: "error", error: errorMessage(err) } : e,
          ),
        );
      });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    ask(input);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Chat
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Ask questions across every meeting - answers are grounded in your
          actual transcripts and summaries.
        </p>
      </div>

      {indexing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Sparkles className="h-6 w-6 animate-pulse text-indigo-400" />
          <p className="text-sm text-slate-500">
            Indexing your meetings for chat…
          </p>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="flex-1 space-y-5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5"
          >
            {exchanges.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Sparkles className="h-6 w-6 text-indigo-400" />
                <p className="text-sm font-semibold text-slate-700">
                  Ask anything about your meetings
                </p>
                <p className="max-w-sm text-sm text-slate-500">
                  Answers only use what was actually said or decided in your
                  recorded meetings.
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  {EXAMPLE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => ask(q)}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Try asking: &ldquo;{q}&rdquo;
                    </button>
                  ))}
                </div>
              </div>
            )}

            {exchanges.map((exchange) => (
              <div key={exchange.id} className="space-y-2">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">
                  {exchange.question}
                </div>

                {exchange.status === "loading" && (
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-500">
                    Thinking…
                  </div>
                )}

                {exchange.status === "error" && (
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-red-50 px-4 py-2 text-sm text-red-700">
                    {exchange.error}
                  </div>
                )}

                {exchange.status === "done" && (
                  <div className="space-y-2">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-800">
                      {exchange.answer}
                    </div>
                    {exchange.sources && exchange.sources.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {exchange.sources.map((source, i) => (
                          <ChatSourceChip key={i} source={source} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about your meetings..."
              className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          </form>
        </>
      )}
    </main>
  );
}
