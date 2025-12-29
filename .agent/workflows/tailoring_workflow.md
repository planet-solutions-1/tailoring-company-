---
description: Tailor Dashboard & Pattern Making Workflow
---

# Tailoring & Pattern Production Workflow

This document outlines the end-to-end process from data entry to pattern creation and production management.

## 1. Data Entry & Filtering (School Editor)
**Location:** `planet_editor.html`
*   **Action:** school dashboard upload student basic data not messurment to database
*   **Filtering:** Users apply filters (Class, Section, Gender, etc.) to isolate a specific group of students (e.g., "Class 10 Boys").
*   **Review:** Verify that measurement data is complete for the filtered group.

## 2. Pattern Creation (Grouping)
**Location:** `planet_editor.html` -> `pattern_view.html` (Creation Mode)
*   **Trigger:** Click the **"Create Pattern"** button in the School Editor after filtering.
*   **Process:**
    1.  System redirects to `pattern_view.html` with the selected student data.
    2.  User enters a **Pattern Name** (e.g., "Standard Uniform - Boys").
    3.  User reviews the "Production Data" (Items & Quantities per student).
    4.  Click **"Save Pattern"**.
*   **Result:**
    *   A new **Pattern Group** is created in the database.
    *   Students are **Linked** to this pattern (`pattern_id` is updated).
    *   Production details are stored.

## 3. Pattern Management (Pattern Master)
**Location:** `pattern_view.html` (View Mode)
*   **Action:** View all created patterns.
*   **Filtering:** Select a specific pattern from the dropdown to see only assigned students.
*   **Maintenance:**
    *   **Delete Pattern:** Select a pattern and click "Delete Pattern" to remove the group and unlink students (data preserved).

## 4. Tailor Dashboard (Production View)
**Location:** `tailoring_dashboard.html`
*   **Audience:** Tailors and Production Managers.
*   **Features:**
    *   **Read-Only View:** Designed for viewing, not editing.
    *   **Filtering:** Filter by School, Pattern, and **Item Type** (e.g., "BOYS - SHIRT").
    *   **Measurement Grid:** Selecting an Item Type dynamically shows the relevant measurement columns (U1-U8, L1-L8).
    *   **Status Tracking:** View which students are "Packed" vs "Pending".
*   **Exports:**
    *   **PDF:** optimized "Cut Sheet" for printing.
    *   **Excel:** Raw data for external processing.

## 5. Production Cleanup (Admin)
**Location:** `company_dashboard.html`
*   **Action:** When a production cycle is complete or for testing.
*   **Reset DB:** Use the "Reset DB" button to clear all patterns and measurements to start fresh.