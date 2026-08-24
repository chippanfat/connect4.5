import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { authClient } from "./auth-client";
import { AppLayout, PageLoader } from "./components";
import { AccountPage } from "./pages/AccountPage";
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  SignInPage,
  SignUpPage,
  VerifyEmailPage,
} from "./pages/AuthPages";
import { DashboardPage } from "./pages/DashboardPage";
import { GamePage } from "./pages/GamePage";
import { InvitePage } from "./pages/InvitePage";
import { LandingPage } from "./pages/LandingPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <PageLoader label="Checking your account" />;
  if (!session) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/join/:code" element={<InvitePage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/game/:gameId"
        element={
          <ProtectedRoute>
            <GamePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <AccountPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
