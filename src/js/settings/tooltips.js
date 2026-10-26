// Ajustes · Tooltips de los ajustes.

function positionSettingTooltip(help, tooltip) {
  if (!tooltip) return;
  const icon = help.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 12;
  const uiZoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const left = Math.max(margin, Math.min(
    icon.left + (icon.width - tooltipRect.width) / 2,
    window.innerWidth - tooltipRect.width - margin
  ));
  const above = icon.top - tooltipRect.height - 10;
  const top = above >= margin ? above : Math.min(window.innerHeight - tooltipRect.height - margin, icon.bottom + 10);
  tooltip.style.left = `${left / uiZoom}px`;
  tooltip.style.top = `${Math.max(margin, top) / uiZoom}px`;
}

export function initSettingTooltips() {
  const helpItems = document.querySelectorAll('.setting-help');
  const tooltipByHelp = new Map();
  helpItems.forEach(help => {
    const tooltip = help.querySelector('.setting-tooltip');
    if (!tooltip) return;
    document.body.appendChild(tooltip);
    tooltipByHelp.set(help, tooltip);

    const showTooltip = () => {
      positionSettingTooltip(help, tooltip);
      tooltip.classList.add('is-visible');
    };
    const hideTooltip = () => {
      if (!help.matches(':hover, :focus')) tooltip.classList.remove('is-visible');
    };

    help.addEventListener('pointerenter', showTooltip);
    help.addEventListener('pointerleave', hideTooltip);
    help.addEventListener('focus', showTooltip);
    help.addEventListener('blur', hideTooltip);
  });
  const repositionVisible = () => helpItems.forEach(help => {
    const tooltip = tooltipByHelp.get(help);
    if (tooltip?.classList.contains('is-visible')) positionSettingTooltip(help, tooltip);
  });
  window.addEventListener('resize', repositionVisible);
  window.addEventListener('scroll', repositionVisible, true);
}
