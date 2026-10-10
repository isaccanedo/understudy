"use client";

import { messages } from "@/lib/messages";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page narrow py-10 flex flex-col gap-3 items-start" role="alert">
      <h1 className="m-0 text-[18px] font-semibold">{messages.common.error}</h1>
      <p className="m-0 text-ash text-[13px]">{messages.common.errorHint}</p>
      <button className="btn sec" onClick={() => reset()}>
        {messages.common.retry}
      </button>
    </div>
  );
}
