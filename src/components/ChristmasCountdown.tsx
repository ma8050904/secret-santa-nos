"use client";

import React, { useEffect, useState } from "react";
import { Sparkles, Clock } from "lucide-react";

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isChristmas: boolean;
}

export const ChristmasCountdown: React.FC = () => {
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);

  useEffect(() => {
    function calculateTime() {
      const now = new Date();
      let currentYear = now.getFullYear();
      let christmas = new Date(currentYear, 11, 25, 0, 0, 0); // Month is 0-indexed: 11 = Dec

      // If Christmas has passed this year, count to next year
      if (now.getTime() > christmas.getTime() + 86400000) {
        currentYear += 1;
        christmas = new Date(currentYear, 11, 25, 0, 0, 0);
      }

      const diff = christmas.getTime() - now.getTime();

      if (diff <= 0 && diff > -86400000) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, isChristmas: true };
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / 1000 / 60) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      return { days, hours, minutes, seconds, isChristmas: false };
    }

    setTimeLeft(calculateTime());

    const timer = setInterval(() => {
      setTimeLeft(calculateTime());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  if (!timeLeft) {
    return (
      <div className="flex justify-center py-4">
        <div className="h-16 w-64 animate-pulse rounded-2xl bg-emerald-950/40" />
      </div>
    );
  }

  if (timeLeft.isChristmas) {
    return (
      <div className="mx-auto my-6 max-w-md rounded-2xl border border-amber-400/40 bg-gradient-to-r from-red-900/80 via-emerald-900/80 to-red-900/80 p-6 text-center shadow-2xl backdrop-blur-md">
        <p className="text-sm font-semibold tracking-widest text-amber-300 uppercase">Merry Christmas!</p>
        <h3 className="mt-1 text-2xl font-bold text-white">IT'S CHRISTMAS DAY! 🎄</h3>
        <p className="mt-1 text-xs text-amber-200/80">May your holiday be filled with wonder and love.</p>
      </div>
    );
  }

  const timeBlocks = [
    { label: "DAYS", value: timeLeft.days },
    { label: "HOURS", value: timeLeft.hours },
    { label: "MINS", value: timeLeft.minutes },
    { label: "SECS", value: timeLeft.seconds },
  ];

  return (
    <div className="mx-auto my-4 max-w-xl px-4">
      <div className="relative rounded-2xl border border-amber-500/25 bg-gradient-to-b from-[#0a2618]/90 to-[#061a10]/95 p-4 md:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.4)] backdrop-blur-xl">
        <div className="mb-3 flex items-center justify-center gap-2">
          <Clock className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold tracking-widest text-amber-300/90 uppercase">
            Christmas Countdown
          </span>
          <Sparkles className="h-4 w-4 text-amber-400" />
        </div>

        <div className="grid grid-cols-4 gap-2 md:gap-4">
          {timeBlocks.map((block) => (
            <div
              key={block.label}
              className="group flex flex-col items-center justify-center rounded-xl border border-amber-400/20 bg-[#123824]/60 p-2.5 md:p-3 transition-transform duration-300 hover:scale-105"
            >
              <span className="font-mono text-2xl font-bold tracking-tight text-white md:text-3xl drop-shadow-[0_2px_8px_rgba(212,175,55,0.4)]">
                {String(block.value).padStart(2, "0")}
              </span>
              <span className="mt-1 text-[10px] font-medium tracking-wider text-amber-300/80 uppercase">
                {block.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
