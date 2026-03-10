(function () {
  const normalize = (value) => {
    const raw = String(value || '').toLowerCase();
    return raw.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  };

  const injectStyles = () => {
    if (document.getElementById('project-search-styles')) return;
    const style = document.createElement('style');
    style.id = 'project-search-styles';
    style.textContent = `
      .project-search-bar { display:flex; gap:8px; align-items:center; margin-bottom:12px; }
      .project-search-input { flex:1; min-width:180px; }
      .project-search-clear { height:32px; }
    `;
    document.head.appendChild(style);
  };

  const init = () => {
    const layersEl = document.getElementById('layers');
    if (!layersEl) return false;
    if (document.getElementById('project-search-bar')) return true;

    injectStyles();

    const bar = document.createElement('div');
    bar.id = 'project-search-bar';
    bar.className = 'project-search-bar';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input-text project-search-input';
    input.placeholder = 'Search projects...';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-secondary project-search-clear';
    clearBtn.textContent = 'Clear';

    bar.appendChild(input);
    bar.appendChild(clearBtn);

    layersEl.parentElement.insertBefore(bar, layersEl);

    const applyFilter = () => {
      const term = normalize(input.value);
      const blocks = layersEl.querySelectorAll('.project-block');
      let firstVisible = null;
      blocks.forEach((block) => {
        const titleEl = block.querySelector('.project-title');
        const label = titleEl ? titleEl.textContent : block.dataset.projectId || '';
        const match = !term || normalize(label).includes(term);
        block.style.display = match ? '' : 'none';
        if (match && !firstVisible) firstVisible = block;
      });
      return firstVisible;
    };

    input.addEventListener('input', () => {
      applyFilter();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const first = applyFilter();
        if (first) {
          first.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (first.classList.contains('is-collapsed')) {
            const toggle = first.querySelector('.project-toggle');
            if (toggle) toggle.click();
          }
        }
      }
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      applyFilter();
      input.focus();
    });

    const observer = new MutationObserver(() => {
      applyFilter();
    });
    observer.observe(layersEl, { childList: true, subtree: false });

    applyFilter();
    return true;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
})();
