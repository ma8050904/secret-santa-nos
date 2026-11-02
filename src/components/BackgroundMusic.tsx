"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Volume2, VolumeX } from "lucide-react";

const TARGET_VOLUME = 0.28;
const FADE_IN_MS = 1400;
const FADE_OUT_MS = 600;

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
    audio.volume = 0;
    const steps = 20;
    const stepDuration = FADE_IN_MS / steps;
    const volStep = TARGET_VOLUME / steps;

    fadeIntervalRef.current = setInterval(() => {
      if (!audioRef.current) {
        clearFade();
        return;
      }
      const newVol = Math.min(TARGET_VOLUME, audio.volume + volStep);
      audio.volume = newVol;
      if (newVol >= TARGET_VOLUME) {
        clearFade();
      }
    }, stepDuration);
  }, []);

  const fadeOutAndPause = useCallback((audio: HTMLAudioElement, callback?: () => void) => {
    clearFade();
    const steps = 15;
    const stepDuration = FADE_OUT_MS / steps;
    const volStep = (audio.volume || TARGET_VOLUME) / steps;

    fadeIntervalRef.current = setInterval(() => {
      if (!audioRef.current) {
        clearFade();
        return;
      }
      const newVol = Math.max(0, audio.volume - volStep);
      audio.volume = newVol;
      if (newVol <= 0.01) {
        clearFade();
        audio.pause();
        audio.volume = 0;
        if (callback) callback();
      }
    }, stepDuration);
  }, []);

  const startPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio
      .play()
      .then(() => {
        setIsPlaying(true);
        fadeIn(audio);
      })
      .catch(() => {
        // Autoplay policy prevented immediate playback; wait for interaction
        setIsPlaying(false);
      });
  }, [fadeIn]);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setIsPlaying(false);
    fadeOutAndPause(audio);
  }, [fadeOutAndPause]);

  useEffect(() => {
    // Instantiate persistent audio element with lazy preload
    const audio = new Audio("/christmas-soundtrack.mp3");
    audio.loop = true;
    audio.preload = "none";
    audio.volume = 0;
    audioRef.current = audio;

    const savedPreference = typeof window !== "undefined" ? localStorage.getItem("santa_music_muted") : null;
    const isMuted = savedPreference === "true";

    // Defer autoplay attempt slightly to allow main thread hydration to finish uninterrupted
    const timer = setTimeout(() => {
      if (!isMuted && audioRef.current) {
        audioRef.current
          .play()
          .then(() => {
            setIsPlaying(true);
            fadeIn(audioRef.current!);
          })
          .catch(() => {
            // Fallback to start on first user interaction
            const handleFirstInteraction = () => {
              if (localStorage.getItem("santa_music_muted") !== "true" && audioRef.current) {
                audioRef.current
                  .play()
                  .then(() => {
                    setIsPlaying(true);
                    fadeIn(audioRef.current!);
                  })
                  .catch(() => {});
              }
              window.removeEventListener("click", handleFirstInteraction);
              window.removeEventListener("touchstart", handleFirstInteraction);
              window.removeEventListener("keydown", handleFirstInteraction);
            };

            window.addEventListener("click", handleFirstInteraction, { passive: true });
            window.addEventListener("touchstart", handleFirstInteraction, { passive: true });
            window.addEventListener("keydown", handleFirstInteraction, { passive: true });
          });
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      clearFade();
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [fadeIn]);

  const toggleMusic = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      localStorage.setItem("santa_music_muted", "true");
      stopPlayback();
    } else {
      localStorage.setItem("santa_music_muted", "false");
      startPlayback();
    }
  };

  return (
    <button
      onClick={toggleMusic}
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
