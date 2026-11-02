"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Volume2, VolumeX } from "lucide-react";

export const BackgroundMusic: React.FC = () => {
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const isPlayingRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Classic gentle festive music box melody ("Silent Night" + "We Wish You A Merry Christmas" soft loop)
  const melody = useRef([
    // Silent Night opening phrase: G4, A4, G4, E4
    { note: 392.0, dur: 0.75, rest: 0.1 },  // G4
    { note: 440.0, dur: 0.25, rest: 0.05 }, // A4
    { note: 392.0, dur: 0.5, rest: 0.1 },   // G4
    { note: 329.63, dur: 1.0, rest: 0.2 },  // E4
    
    // G4, A4, G4, E4
    { note: 392.0, dur: 0.75, rest: 0.1 },  // G4
    { note: 440.0, dur: 0.25, rest: 0.05 }, // A4
    { note: 392.0, dur: 0.5, rest: 0.1 },   // G4
    { note: 329.63, dur: 1.0, rest: 0.2 },  // E4

    // D5, D5, B4
    { note: 587.33, dur: 0.75, rest: 0.1 }, // D5
    { note: 587.33, dur: 0.35, rest: 0.05 },// D5
    { note: 493.88, dur: 1.0, rest: 0.2 },  // B4

    // C5, C5, G4
    { note: 523.25, dur: 0.75, rest: 0.1 }, // C5
    { note: 523.25, dur: 0.35, rest: 0.05 },// C5
    { note: 392.0, dur: 1.0, rest: 0.2 },   // G4

    // Carol chime: A4, B4, C5, A4, G4, A4, G4, E4
    { note: 440.0, dur: 0.5, rest: 0.1 },   // A4
    { note: 493.88, dur: 0.35, rest: 0.05 },// B4
    { note: 523.25, dur: 0.5, rest: 0.1 },  // C5
    { note: 440.0, dur: 0.35, rest: 0.1 },  // A4
    { note: 392.0, dur: 0.5, rest: 0.1 },   // G4
    { note: 440.0, dur: 0.35, rest: 0.1 },  // A4
    { note: 392.0, dur: 0.5, rest: 0.1 },   // G4
    { note: 329.63, dur: 1.2, rest: 0.4 },  // E4

    // Soft holiday resolution: D4, G4, B4, D5, C5
    { note: 293.66, dur: 0.4, rest: 0.05 }, // D4
    { note: 392.0, dur: 0.4, rest: 0.05 },  // G4
    { note: 493.88, dur: 0.4, rest: 0.05 }, // B4
    { note: 587.33, dur: 0.6, rest: 0.1 },  // D5
    { note: 523.25, dur: 1.5, rest: 0.8 },  // C5
  ]);

  const currentStepRef = useRef(0);

  const playNextNote = useCallback(() => {
    if (!isPlayingRef.current || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const step = currentStepRef.current;
    const item = melody.current[step];

    // Warm Celesta / Holiday Bell Synthesis
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Harmonics for rich music box warmth
    osc.type = "sine";
    osc.frequency.setValueAtTime(item.note, now);

    // Warm envelope
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + item.dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + item.dur + 0.1);

    // Sub-oscillator for warmth
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(item.note * 0.5, now);
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.03, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + item.dur * 0.8);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + item.dur + 0.1);

    currentStepRef.current = (step + 1) % melody.current.length;
    const nextInterval = (item.dur + item.rest) * 1000;
    timerRef.current = setTimeout(playNextNote, nextInterval);
  }, []);

  const startMusic = useCallback(() => {
    if (isPlayingRef.current) return;

    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtxClass();
      }

      const ctx = audioCtxRef.current;

      if (ctx.state === "suspended") {
        ctx.resume().then(() => {
          isPlayingRef.current = true;
          setIsPlaying(true);
          playNextNote();
        }).catch(() => {});
      } else {
        isPlayingRef.current = true;
        setIsPlaying(true);
        playNextNote();
      }
    } catch {
      // Audio not supported
    }
  }, [playNextNote]);

  const stopMusic = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state === "running") {
      audioCtxRef.current.suspend().catch(() => {});
    }
  }, []);

  // Initialization & Autoplay with Fallback
  useEffect(() => {
    // Check saved mute preference
    const savedMute = localStorage.getItem("santa_music_muted");
    if (savedMute === "true") {
      setIsMuted(true);
      return;
    }

    // Attempt automatic start
    startMusic();

    // Browser autoplay policy fallback: start on first user interaction
    const unlockAudio = () => {
      if (!isPlayingRef.current && localStorage.getItem("santa_music_muted") !== "true") {
        startMusic();
      }
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };

    window.addEventListener("click", unlockAudio, { passive: true });
    window.addEventListener("touchstart", unlockAudio, { passive: true });
    window.addEventListener("keydown", unlockAudio, { passive: true });

    return () => {
      stopMusic();
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [startMusic, stopMusic]);

  const toggleMute = () => {
    if (isPlaying) {
      stopMusic();
      setIsMuted(true);
      localStorage.setItem("santa_music_muted", "true");
    } else {
      setIsMuted(false);
      localStorage.setItem("santa_music_muted", "false");
      startMusic();
    }
  };

  return (
    <button
      onClick={toggleMute}
      aria-label={isPlaying ? "Mute Christmas music" : "Play Christmas music"}
      title={isPlaying ? "Mute Holiday Music" : "Play Holiday Music"}
      className="group flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-[#123824]/80 px-2.5 py-1.5 text-xs text-amber-200 transition-all hover:border-amber-400 hover:bg-[#1b4d32] hover:text-white shadow-sm"
    >
      {isPlaying ? (
        <>
          <Volume2 className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
          <span className="hidden sm:inline text-[11px] font-medium tracking-wide">Music On</span>
        </>
      ) : (
        <>
          <VolumeX className="h-3.5 w-3.5 text-amber-300/70" />
          <span className="hidden sm:inline text-[11px] font-medium tracking-wide">Music Muted</span>
        </>
      )}
    </button>
  );
};
