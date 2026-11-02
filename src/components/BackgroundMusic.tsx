"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Volume2, VolumeX } from "lucide-react";

const TARGET_VOLUME = 0.28;
const FADE_IN_MS = 1400;
const FADE_OUT_MS = 600;

function safeGetStorage(key: string): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // In-app browsers or private mode may restrict storage
  }
  return null;
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // In-app browsers or private mode may restrict storage
  }
}

export const BackgroundMusic: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearFade = () => {
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }
  };

  const fadeIn = useCallback((audio: HTMLAudioElement) => {
    clearFade();
    try {
      audio.volume = 0;
      const steps = 20;
      const stepDuration = FADE_IN_MS / steps;
      const volStep = TARGET_VOLUME / steps;

      fadeIntervalRef.current = setInterval(() => {
        if (!audioRef.current) {
          clearFade();
          return;
        }
        try {
          const newVol = Math.min(TARGET_VOLUME, audio.volume + volStep);
          audio.volume = newVol;
          if (newVol >= TARGET_VOLUME) {
            clearFade();
          }
        } catch {
          clearFade();
        }
      }, stepDuration);
    } catch {
      // Audio volume manipulation failed gracefully
    }
  }, []);

  const fadeOutAndPause = useCallback((audio: HTMLAudioElement, callback?: () => void) => {
    clearFade();
    try {
      const steps = 15;
      const stepDuration = FADE_OUT_MS / steps;
      const volStep = (audio.volume || TARGET_VOLUME) / steps;

      fadeIntervalRef.current = setInterval(() => {
        if (!audioRef.current) {
          clearFade();
          return;
        }
        try {
          const newVol = Math.max(0, audio.volume - volStep);
          audio.volume = newVol;
          if (newVol <= 0.01) {
            clearFade();
            audio.pause();
            audio.volume = 0;
            if (callback) callback();
          }
        } catch {
          clearFade();
          try {
            audio.pause();
          } catch {
            // ignore
          }
        }
      }, stepDuration);
    } catch {
      try {
        audio.pause();
      } catch {
        // ignore
      }
    }
  }, []);

  const startPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
            fadeIn(audio);
          })
          .catch(() => {
            // Autoplay policy prevented playback until user interaction
            setIsPlaying(false);
          });
      }
    } catch {
      setIsPlaying(false);
    }
  }, [fadeIn]);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setIsPlaying(false);
    fadeOutAndPause(audio);
  }, [fadeOutAndPause]);

  useEffect(() => {
    let audio: HTMLAudioElement | null = null;
    let timer: NodeJS.Timeout | null = null;

    try {
      if (typeof window !== "undefined" && typeof Audio !== "undefined") {
        audio = new Audio("/christmas-soundtrack.mp3");
        audio.loop = true;
        audio.preload = "none";
        audio.volume = 0;
        audioRef.current = audio;

        const savedPreference = safeGetStorage("santa_music_muted");
        const isMuted = savedPreference === "true";

        if (!isMuted) {
          timer = setTimeout(() => {
            if (audioRef.current && safeGetStorage("santa_music_muted") !== "true") {
              startPlayback();
            }
          }, 600);
        }
      }
    } catch {
      // Audio element not supported or blocked by policy
    }

    return () => {
      if (timer) clearTimeout(timer);
      clearFade();
      if (audio) {
        try {
          audio.pause();
          audio.src = "";
        } catch {
          // ignore
        }
      }
      audioRef.current = null;
    };
  }, [startPlayback]);

  const toggleMusic = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      safeSetStorage("santa_music_muted", "true");
      stopPlayback();
    } else {
      safeSetStorage("santa_music_muted", "false");
      startPlayback();
    }
  };

  return (
    <button
      onClick={toggleMusic}
      type="button"
      aria-label={isPlaying ? "Mute Christmas music" : "Play Christmas music"}
      title={isPlaying ? "Mute Christmas Music" : "Play Christmas Music"}
      className="group flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-[#123824]/80 px-2.5 py-1.5 text-xs text-amber-200 transition-all hover:border-amber-400 hover:bg-[#1b4d32] hover:text-white shadow-sm cursor-pointer"
    >
      {isPlaying ? (
        <>
          <Volume2 className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
          <span className="hidden sm:inline text-[11px] font-medium tracking-wide">Music On</span>
        </>
      ) : (
        <>
          <VolumeX className="h-3.5 w-3.5 text-amber-300/70" />
          <span className="hidden sm:inline text-[11px] font-medium tracking-wide">Music Off</span>
        </>
      )}
    </button>
  );
};
