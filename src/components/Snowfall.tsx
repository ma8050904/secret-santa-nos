"use client";

import React, { useEffect, useRef } from "react";

interface Flake {
  x: number;
  y: number;
  radius: number;
  density: number;
  opacity: number;
  speedY: number;
  speedX: number;
  swayAmplitude: number;
  swaySpeed: number;
  swayOffset: number;
  twinkleSpeed: number;
  isForeground: boolean;
}

export const Snowfall: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Respect user's reduced motion preference
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", handleResize);

    // Multi-layered realistic flake population
    const totalFlakes = Math.min(100, Math.floor((width * height) / 10000));
    const flakes: Flake[] = [];

    for (let i = 0; i < totalFlakes; i++) {
      const isForeground = i % 8 === 0; // 12% large foreground flakes
      const radius = isForeground
        ? Math.random() * 2.2 + 2.0
        : Math.random() * 1.8 + 0.6;

      flakes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius,
        density: Math.random() * 30 + 1,
        opacity: isForeground ? Math.random() * 0.5 + 0.4 : Math.random() * 0.6 + 0.2,
        speedY: isForeground ? Math.random() * 1.4 + 0.8 : Math.random() * 0.8 + 0.4,
        speedX: Math.random() * 0.4 - 0.2,
        swayAmplitude: isForeground ? Math.random() * 1.8 + 0.8 : Math.random() * 1.0 + 0.3,
        swaySpeed: Math.random() * 0.02 + 0.008,
        swayOffset: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.03 + 0.01,
        isForeground,
      });
    }

    let time = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      time += 0.02;

      for (let i = 0; i < flakes.length; i++) {
        const flake = flakes[i];

        flake.y += flake.speedY;
        flake.x += Math.sin(time * flake.swaySpeed + flake.swayOffset) * flake.swayAmplitude + flake.speedX;

        // Twinkle opacity oscillation
        const dynamicOpacity = Math.max(
          0.1,
          Math.min(1, flake.opacity + Math.sin(time * flake.twinkleSpeed) * 0.15)
        );

        // Wrap around seamlessly
        if (flake.y > height + 10) {
          flake.y = -10;
          flake.x = Math.random() * width;
        }
        if (flake.x > width + 10) {
          flake.x = -10;
        } else if (flake.x < -10) {
          flake.x = width + 10;
        }

        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2, false);

        if (flake.isForeground) {
          // Soft golden/white glow on large foreground flakes
          ctx.fillStyle = `rgba(254, 243, 199, ${dynamicOpacity})`;
          ctx.shadowBlur = 6;
          ctx.shadowColor = "rgba(254, 243, 199, 0.6)";
        } else {
          ctx.fillStyle = `rgba(255, 255, 255, ${dynamicOpacity})`;
          ctx.shadowBlur = flake.radius > 1.5 ? 3 : 0;
          ctx.shadowColor = "rgba(255, 255, 255, 0.4)";
        }

        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-10 h-full w-full"
      aria-hidden="true"
    />
  );
};
