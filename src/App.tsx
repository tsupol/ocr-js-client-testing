import { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { Home, FileText, ScanText, Camera, Smartphone, Bug } from 'lucide-react';
import { OcrTestPage } from './pages/OcrTestPage';
import { CameraOcrPage } from './pages/CameraOcrPage';
import { IPhoneSerialPage } from './pages/IPhoneSerialPage';
import { OcrDebugPage } from './pages/OcrDebugPage';
import { SideMenu, ModalProvider, SnackbarProvider } from 'tsp-form';
import { clsx } from 'clsx';

const SideNav = () => {
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const navigate = useNavigate();

  const customMenuItems = [
    { icon: <Home size="1rem"/>, label: "Dashboard", to: '/' },
    { icon: <ScanText size="1rem"/>, label: "OCR Test", to: '/ocr-test' },
    { icon: <Camera size="1rem"/>, label: "Camera OCR", to: '/camera-ocr' },
    { icon: <Smartphone size="1rem"/>, label: "iPhone Serial", to: '/iphone-serial' },
    { icon: <Bug size="1rem"/>, label: "OCR Debug", to: '/ocr-debug' },
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
          <div className="flex flex-col w-full h-full min-h-0">
            <div className="side-menu-content better-scroll">
              <div className={clsx('p-2 flex flex-col w-side-menu', menuCollapsed ? 'items-start' : '')}>
                {customMenuItems.map((item, index) => {
                  return (
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
                  );
                })}
              </div>
            </div>
            <div className="h-10 w-full border-t border-line flex justify-center items-center p-4">
              {menuCollapsed ? 'U' : 'User'}
            </div>
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
                <Route path="/camera-ocr" element={<CameraOcrPage />} />
                <Route path="/iphone-serial" element={<IPhoneSerialPage />} />
                <Route path="/ocr-debug" element={<OcrDebugPage />} />
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
