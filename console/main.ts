import { initConfigUI } from './config/main.js';
import { initRegistryUI } from './registry/main.js';

type MenuAction = () => Promise<void | (() => void)>;
let activeMenu: Element | null = null;
let activeCleanup: (() => void) | null = null;

function bindSidebarState() {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.querySelector('#sidebarToggle');

  if (!sidebar || !toggle) {
    return;
  }

  toggle.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('active');
      return;
    }

    document.body.classList.toggle('sidebar-collapsed');
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      sidebar.classList.remove('active');
    }
  });
}

async function activateMenu(item: Element, action: MenuAction) {
  if (activeMenu === item) {
    return;
  }

  if (typeof activeCleanup === 'function') {
    activeCleanup();
    activeCleanup = null;
  }

  const menus = Array.from(document.querySelectorAll('.menu-item'));
  menus.forEach((menuItem) => menuItem.classList.remove('active'));
  item.classList.add('active');

  const cleanup = await action();
  activeMenu = item;
  activeCleanup = typeof cleanup === 'function' ? cleanup : null;

  if (window.innerWidth <= 768) {
    document.querySelector('.sidebar')?.classList.remove('active');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const configMenu = document.querySelector('#configMenu');
  const serverMenu = document.querySelector('#serverMenu');
  bindSidebarState();

  if (!configMenu || !serverMenu) return;
  const menuActions = new Map<Element, MenuAction>([
    [configMenu, initConfigUI],
    [serverMenu, initRegistryUI],
  ]);

  menuActions.forEach((action, item) => {
    item.addEventListener('click', () => {
      void activateMenu(item, action);
    });
  });

  await activateMenu(serverMenu, initRegistryUI);
});
