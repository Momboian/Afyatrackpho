// Entry point of the website. It loads the styles, the login state and every page, then shows the right page for each address.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
// Tailwind styles for the whole site.
import './index.css';
// Login state and shared screen parts.
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import { ToastProvider, Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
// The pages of the app.
import Login, { ForgotPassword, ResetPassword } from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Planner, { TaskDetail } from './pages/Planner.jsx';
import Activities from './pages/Activities.jsx';
import Registers, { RegisterProfile } from './pages/Registers.jsx';
import Inspections, { InspectionForm, InspectionDetail } from './pages/Inspections.jsx';
import FollowUps from './pages/FollowUps.jsx';
import Notices, { NoticeDetail } from './pages/Notices.jsx';
import Reports from './pages/Reports.jsx';
import Team from './pages/Team.jsx';
import SettingsPage from './pages/Settings.jsx';

// Wraps pages that need a login. While checking the login it shows a spinner, and without a login it sends the user to /login.
function Protected({ children }) {
  const { loading, me } = useAuth();
  if (loading) return <Spinner label="Opening AfyaTrack…" />;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}
// Wraps the login pages. A user who is already signed in is sent to the dashboard.
function PublicOnly({ children }) {
  const { loading, me } = useAuth();
  if (loading) return <Spinner />;
  if (me) return <Navigate to="/" replace />;
  return children;
}

// The list of addresses (routes) and the page shown for each.
function App() {
  return (
    <Routes>
      {/* Pages anyone can open. */}
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Pages inside Layout (side menu and top bar). All of them need a login. */}
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="planner" element={<Planner />} />
        <Route path="planner/:id" element={<TaskDetail />} />
        <Route path="activities" element={<Activities />} />
        <Route path="registers/:type" element={<Registers />} />
        <Route path="registers/:type/:id" element={<RegisterProfile />} />
        <Route path="inspections" element={<Inspections />} />
        <Route path="inspections/new" element={<InspectionForm />} />
        <Route path="inspections/:id" element={<InspectionDetail />} />
        <Route path="follow-ups" element={<FollowUps />} />
        <Route path="notices" element={<Notices />} />
        <Route path="notices/:id" element={<NoticeDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="team" element={<Team />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      {/* Any unknown address goes back to the dashboard. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Start React inside the <div id="root"> in client/index.html.
// BrowserRouter handles the addresses, AuthProvider holds the login, ToastProvider shows pop up messages.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider><App /></ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
