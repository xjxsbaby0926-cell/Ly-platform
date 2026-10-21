/* 入口页主视觉:自动循环的视频 + 粒子
   ---------------------------------------------------------------------------
   上一版是“滚动驱动逐帧”:滚轮一动画面就换帧,看起来像跟着鼠标走,
   而且要先解码几十帧才有画面。这一版按最直接的方式做:

     · <video autoplay loop muted playsinline> 原生循环播放 ——
       浏览器缓冲到就能出画面,硬件解码,不用预抽帧、不用 canvas,
       CPU 和内存都最省,循环也不会跳;
     · 一层很淡的粒子缓慢漂移(30fps,看不到时停);
     · 滚动只负责两件事:首屏淡出、第二屏浮现。

   没有任何鼠标/指针相关的逻辑。
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  const video = document.getElementById('heroVideo');
  const media = document.getElementById('heroMedia') || (video && video.parentElement);
  const particlesCanvas = document.getElementById('heroParticles');
  const heroInner = document.getElementById('heroInner');
  const principles = document.getElementById('principlesInner');
  if (!video || !media) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.matchMedia('(max-width: 800px)').matches;

  /* ---------- 视频:准备好就淡入 ---------- */
  const show = () => media.classList.add('is-ready');
  if (video.readyState >= 2) show();
  ['loadeddata', 'canplay', 'playing'].forEach(name => {
    video.addEventListener(name, show, { once: true });
  });

  if (reduceMotion) {
    // 减少动态效果:停在第一帧,不循环
    video.autoplay = false;
    video.loop = false;
    try { video.pause(); } catch (error) {}
    show();
  } else {
    // 自动播放若被策略拦下,等用户第一次交互再启动
    video.play().catch(() => {
      const kick = () => {
        video.play().catch(() => {});
        window.removeEventListener('pointerdown', kick);
      };
      window.addEventListener('pointerdown', kick, { once: true });
    });

    // 切到别的标签页时浏览器会暂停播放,切回来要重新拉起
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && video.paused) video.play().catch(() => {});
    });
  }

  /* ---------- 粒子 ---------- */
  const startParticles = () => {
    if (!particlesCanvas || reduceMotion || small) return;
    const ctx = particlesCanvas.getContext('2d');
    let dots = [];

    const resize = () => {
      particlesCanvas.width = window.innerWidth;
      particlesCanvas.height = window.innerHeight;
      const count = Math.min(46, Math.floor((particlesCanvas.width * particlesCanvas.height) / 34000));
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * particlesCanvas.width,
        y: Math.random() * particlesCanvas.height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.4 + 0.4,
        a: Math.random() * 0.32 + 0.1
      }));
    };
    resize();
    window.addEventListener('resize', resize);

    let lastDraw = 0;
    const tick = now => {
      requestAnimationFrame(tick);
      // 看不见时不画:窗口在后台,或已经滚过第一屏
      if (document.hidden || window.scrollY > window.innerHeight * 1.2) return;
      // 30fps 足够:粒子只是缓慢漂移,60fps 肉眼看不出差别,却多付一倍合成成本
      if (now - lastDraw < 1000 / 30) return;
      lastDraw = now;

      ctx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
      dots.forEach(d => {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0) d.x = particlesCanvas.width;
        else if (d.x > particlesCanvas.width) d.x = 0;
        if (d.y < 0) d.y = particlesCanvas.height;
        else if (d.y > particlesCanvas.height) d.y = 0;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,246,236,' + d.a + ')';
        ctx.fill();
      });
    };
    requestAnimationFrame(tick);
  };

  /* ---------- 滚动:首屏淡出、第二屏浮现 ---------- */
  const onScroll = () => {
    if (heroInner) {
      const fade = Math.max(0, 1 - window.scrollY / (window.innerHeight * 0.6));
      heroInner.style.opacity = String(fade);
      heroInner.style.transform = `translateY(${((1 - fade) * -18).toFixed(1)}px)`;
    }
    if (principles && !principles.classList.contains('is-visible')) {
      const rect = principles.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.78) principles.classList.add('is-visible');
    }
  };

  if (principles) {
    if ('IntersectionObserver' in window && !reduceMotion) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) { principles.classList.add('is-visible'); io.disconnect(); }
        });
      }, { threshold: 0.2 });
      io.observe(principles);
    } else {
      principles.classList.add('is-visible');
    }
  }

  startParticles();
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
