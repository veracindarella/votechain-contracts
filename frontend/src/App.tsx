// Copyright 2024 VoteChain Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NavHeader } from "./components/NavHeader";
import { useTranslation } from "react-i18next";
import { useTransactionStatus } from "./hooks/useTransactionStatus";
import { TransactionToast } from "./components/TransactionToast";

/**
 * Page components — consumed lazily to keep the initial bundle small.
 */
const ProposalList     = React.lazy(() => import('./pages/ProposalList'));
const ProposalDetail   = React.lazy(() => import('./pages/ProposalDetail'));
const VotingPanel      = React.lazy(() => import('./pages/VotingPanel'));
const VoteHistory      = React.lazy(() => import('./pages/VoteHistory'));
const GovernanceDashboard = React.lazy(() =>
  import('./pages/GovernanceDashboard').then((m) => ({ default: m.GovernanceDashboard ?? m.default }))
);
const Simulate = React.lazy(() => import('./pages/Simulate'));
const CreateProposal = React.lazy(() => import('./pages/CreateProposal'));
const Leaderboard = React.lazy(() => import('./pages/Leaderboard'));
const NotFound = React.lazy(() => import('./pages/NotFound'));

/** Updates the document title on route change (issue #16 — browser history / a11y). */
function PageTitle({ title }: { title: string }) {
  React.useEffect(() => {
    document.title = `${title} | VoteChain`;
  }, [title]);
  return null;
}

function AppRoutes() {
  const { t } = useTranslation();
  const fallback = <p>{t("app.loading")}</p>;

  return (
    <>
      <NavHeader />
      <main>
        <React.Suspense fallback={fallback}>
          <Routes>
            <Route
              path="/"
              element={
                <ErrorBoundary section="ProposalList">
                  <PageTitle title="Proposals" />
                  <ProposalList />
                </ErrorBoundary>
              }
            />
            <Route
              path="/proposals/:id"
              element={
                <ErrorBoundary section="ProposalDetail">
                  <PageTitle title="Proposal Detail" />
                  <ProposalDetail />
                </ErrorBoundary>
              }
            />
            <Route
              path="/vote/:id"
              element={
                <ErrorBoundary section="VotingPanel">
                  <PageTitle title="Cast Vote" />
                  <VotingPanel />
                </ErrorBoundary>
              }
            />
            <Route
              path="/history"
              element={
                <ErrorBoundary section="VoteHistory">
                  <PageTitle title="Vote History" />
                  <VoteHistory />
                </ErrorBoundary>
              }
            />
            {/* Issue #16 — GovernanceDashboard route */}
            <Route
              path="/dashboard"
              element={
                <ErrorBoundary section="GovernanceDashboard">
                  <PageTitle title="Dashboard" />
                  <GovernanceDashboard />
                </ErrorBoundary>
              }
            />
            {/* Issue #111 — Proposal simulation / quorum explorer */}
            <Route
              path="/simulate"
              element={
                <ErrorBoundary section="Simulate">
                  <PageTitle title="Simulate" />
                  <Simulate />
                </ErrorBoundary>
              }
            />
            {/* Issue #325 — Voter leaderboard */}
            <Route
              path="/leaderboard"
              element={
                <ErrorBoundary section="Leaderboard">
                  <PageTitle title="Leaderboard" />
                  <Leaderboard />
                </ErrorBoundary>
              }
            />
            <Route
              path="*"
              element={
                <ErrorBoundary section="NotFound">
                  <PageTitle title="Not Found" />
                  <NotFound />
                </ErrorBoundary>
              }
            />
          </Routes>
        </React.Suspense>
      </main>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary section="App">
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
