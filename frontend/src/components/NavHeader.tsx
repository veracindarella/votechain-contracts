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

import React, { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router-dom';

interface NavHeaderProps {
  walletSlot?: React.ReactNode;
}

/**
 * NavHeader — responsive navigation header that collapses to a
 * hamburger menu on viewports narrower than 600 px (issue #12).
 */
export function NavHeader({ walletSlot }: NavHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Close menu when focus leaves the nav area
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="site-header" ref={navRef as React.Ref<HTMLElement>}>
      <div className="container">
        <div className="header-inner">
          <a href="/" className="logo" aria-label="VoteChain home">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M7 11l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            VoteChain
          </a>

          {/* Desktop navigation */}
          <nav className="desktop-nav" aria-label="Main navigation">
            <ul className="nav-list">
              <li><NavLink to="/" end className={({ isActive }) => isActive ? 'nav-active' : undefined}>Proposals</NavLink></li>
              <li><NavLink to="/leaderboard" className={({ isActive }) => isActive ? 'nav-active' : undefined}>Leaderboard</NavLink></li>
              <li><NavLink to="/dashboard" className={({ isActive }) => isActive ? 'nav-active' : undefined}>Dashboard</NavLink></li>
              <li><NavLink to="/history" className={({ isActive }) => isActive ? 'nav-active' : undefined}>Vote History</NavLink></li>
              <li><NavLink to="/profile" className={({ isActive }) => isActive ? 'nav-active' : undefined}>Profile</NavLink></li>
            </ul>
          </nav>

          <div className="header-actions">
            {walletSlot}

            {/* Hamburger button — visible only on mobile */}
            <button
              className="hamburger-btn"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="hamburger-bar" />
              <span className="hamburger-bar" />
              <span className="hamburger-bar" />
            </button>
          </div>
        </div>

        {/* Mobile navigation drawer */}
        <nav
          id="mobile-menu"
          className={`mobile-nav${menuOpen ? ' mobile-nav--open' : ''}`}
          aria-label="Mobile navigation"
          aria-hidden={!menuOpen}
        >
          <ul className="mobile-nav-list">
            <li><NavLink to="/" end onClick={() => setMenuOpen(false)}>Proposals</NavLink></li>
            <li><NavLink to="/leaderboard" onClick={() => setMenuOpen(false)}>Leaderboard</NavLink></li>
            <li><NavLink to="/dashboard" onClick={() => setMenuOpen(false)}>Dashboard</NavLink></li>
            <li><NavLink to="/history" onClick={() => setMenuOpen(false)}>Vote History</NavLink></li>
            <li><NavLink to="/profile" onClick={() => setMenuOpen(false)}>Profile</NavLink></li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
