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
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="container">
      <section
        className="card"
        role="main"
        aria-labelledby="not-found-title"
        style={{ textAlign: "center" }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 22 22"
          fill="none"
          aria-hidden="true"
          style={{ marginBottom: "0.5rem" }}
        >
          <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="2" />
          <path
            d="M7 11l3 3 5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h1 id="not-found-title" style={{ fontSize: "2rem" }}>
          {t("notFound.title", "404 — Page not found")}
        </h1>
        <p style={{ color: "var(--color-text-muted, #64748b)" }}>
          {t(
            "notFound.description",
            "The page you were looking for does not exist.",
          )}
        </p>
        <Link to="/dashboard">{t("notFound.dashboardLink", "Go to dashboard")}</Link>
      </section>
    </div>
  );
}
