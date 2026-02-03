import { useState, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { Home, FileText, Settings, HelpCircle, LogOut, ChevronRight, ScanText } from 'lucide-react';
import { OcrTestPage } from './pages/OcrTestPage';
import { SideMenu, PopOver, ModalProvider, SnackbarProvider, useSnackbarContext } from 'tsp-form';
import { clsx } from 'clsx';

function UserMenuItem({ icon, label, onClick, shortcut, danger }: {
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  shortcut?: string;
  danger?: boolean;
}) {
  return (
    <button
      className={clsx(
        'w-full text-left px-3 py-1.5 text-sm hover:bg-surface-hover transition-colors cursor-pointer flex items-center gap-2',
        danger ? 'text-danger' : ''
      )}
      onClick={onClick}
    >
      {icon && <span className="w-4 h-4 flex items-center justify-center opacity-70">{icon}</span>}
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-xs opacity-50">{shortcut}</span>}
    </button>
  );
}

function UserSubMenu({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="right"
      align="start"
      offset={0}
      openDelay={0}
      trigger={
        <button
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-hover transition-colors cursor-pointer flex items-center gap-2"
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          onMouseLeave={() => scheduleClose()}
        >
          {icon && <span className="w-4 h-4 flex items-center justify-center opacity-70">{icon}</span>}
          <span className="flex-1">{label}</span>
          <ChevronRight size={14} className="opacity-50" />
        </button>
      }
    >
      <div
        className="py-1 min-w-[180px]"
        onMouseEnter={() => cancelClose()}
        onMouseLeave={() => scheduleClose()}
      >
        {children}
      </div>
    </PopOver>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const { addSnackbar } = useSnackbarContext();

  const handleAction = (action: string) => {
    addSnackbar({ message: action });
    setOpen(false);
  };

  return (
    <PopOver
      isOpen={open}
      onClose={() => setOpen(false)}
      placement="top"
      align="start"
      offset={4}
      openDelay={0}
      triggerClassName="w-full"
      trigger={
        <button
          className="h-12 w-full border-t border-line flex items-center gap-2 px-2 hover:bg-surface-hover transition-colors cursor-pointer"
          onClick={() => setOpen(!open)}
        >
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-contrast text-sm font-medium shrink-0">
            U
          </div>
          {!collapsed && (
            <div className="flex flex-col items-start text-left min-w-0">
              <span className="text-sm font-medium truncate">User</span>
              <span className="text-xs opacity-60 truncate">Free Plan</span>
            </div>
          )}
        </button>
      }
    >
      <div className="py-1 min-w-[200px]">
        <UserSubMenu icon={<Settings size={14} />} label="Settings">
          <UserMenuItem label="General" onClick={() => handleAction('Settings > General')} />
          <UserSubMenu label="Theme">
            <UserMenuItem label="Light" onClick={() => handleAction('Theme > Light')} />
            <UserMenuItem label="Dark" onClick={() => handleAction('Theme > Dark')} />
          </UserSubMenu>
        </UserSubMenu>
        <UserMenuItem
          icon={<HelpCircle size={14} />}
          label="Help"
          onClick={() => handleAction('Help')}
        />
        <hr className="border-line my-1" />
        <UserMenuItem
          icon={<LogOut size={14} />}
          label="Sign out"
          onClick={() => handleAction('Sign out')}
          danger
        />
      </div>
    </PopOver>
  );
}

const SideNav = () => {
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const navigate = useNavigate();

  const menuItems = [
    { icon: <Home size="1rem"/>, label: "Dashboard", to: '/' },
    { icon: <ScanText size="1rem"/>, label: "OCR Test", to: '/ocr-test' },
    { icon: <FileText size="1rem"/>, label: "Documents", to: '/docs' },
  ];

  return (
    <div className={clsx('h-screen flex-shrink-0', menuCollapsed ? 'md:w-side-menu-min' : 'md:w-side-menu')}>
      <SideMenu
        isCollapsed={false}
        onToggleCollapse={(collapsed) => setMenuCollapsed(collapsed)}
        linkFn={(to) => navigate(to)}
        className="bg-surface-shallow border-r border-line"
        titleRenderer={(collapsed, handleToggle) => (
          <div className="flex pointer-events-auto relative w-side-menu p-2" onClick={() => handleToggle()}>
            <button
              className="bg-primary text-primary-contrast w-8 h-8 shrink-0 cursor-pointer rounded-lg"
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            >
              {collapsed ? '>' : '<'}
            </button>
            <div className="flex justify-center items-center w-full cursor-pointer"
                 style={{ visibility: collapsed ? 'hidden' : 'visible' }}>OCR Client
            </div>
          </div>
        )}
        items={(
          <div className="flex flex-col w-full h-full min-h-0 pointer-events-auto">
            <div className="side-menu-content better-scroll">
              <div className={clsx('p-2 flex flex-col w-side-menu', menuCollapsed ? 'items-start' : '')}>
                {menuItems.map((item, index) => (
                  <Link key={index} className="flex py-1 rounded-lg transition-all text-item-fg hover:bg-item-hover-bg" to={item.to}>
                    <div className="flex justify-center items-center w-8 h-8">
                      {item.icon}
                    </div>
                    {!menuCollapsed && (
                      <div className="flex items-center">
                        {item.label}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
            <UserMenu collapsed={menuCollapsed} />
          </div>
        )}
      />
    </div>
  );
};

function Dashboard() {
  return (
    <div>
      <h1 className="text-title font-semibold mb-4">Dashboard</h1>
      <p>Welcome to OCR JS Client</p>
    </div>
  );
}

function Documents() {
  return (
    <div>
      <h1 className="text-title font-semibold mb-4">Documents</h1>
      <p>Document management page</p>
    </div>
  );
}

function App() {
  return (
    <ModalProvider>
      <SnackbarProvider>
        <BrowserRouter>
          <div className="flex">
            <SideNav />
            <div className="p-4 flex-1">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/ocr-test" element={<OcrTestPage />} />
                <Route path="/docs" element={<Documents />} />
              </Routes>
            </div>
          </div>
        </BrowserRouter>
      </SnackbarProvider>
    </ModalProvider>
  );
}

export default App;
