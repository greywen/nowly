const hero = document.querySelector('.hero');
if (hero && 'IntersectionObserver' in window) {
  const reveal = (element, index = 0) => {
    element.style.setProperty('--site-motion-index', String(index));
    element.classList.add('site__reveal');
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target;
      const index = element.matches('.site__card') ? [...element.parentElement.children].indexOf(element) % 4 : 0;
      reveal(element, index);
      observer.unobserve(element);
    }
  }, { threshold: 0.08 });
  document.querySelectorAll('.hero__copy > *, .hero__showcase').forEach((element, index) => reveal(element, index));
  document.querySelectorAll('.site__section > h2, .site__card, .site__notice').forEach(element => observer.observe(element));
}
