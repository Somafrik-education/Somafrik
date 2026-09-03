#!/usr/bin/env python3
"""Generate Somafrik's Google Play Data safety CSV.

Keep this file aligned with the actual Android release behavior and with the
current CSV template exported by Google Play Console.
"""

from __future__ import annotations

import csv
from pathlib import Path

OUTPUT = Path(__file__).with_name("somafrik_google_play_data_safety.csv")
EXPECTED_ROWS_WITH_HEADER = 783

HEADER = [
    "Question ID (machine readable)",
    "Response ID (machine readable)",
    "Response value",
    "Answer requirement",
    "Human-friendly question label",
]

rows: list[list[str]] = []


def add(qid: str, rid: str = "", value: str = "", requirement: str = "", label: str = "") -> None:
    rows.append([qid, rid, value, requirement, label])


# General questions.
add(
    "PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA", "", "TRUE", "REQUIRED",
    "Does your app collect or share any of the required user data types?",
)
add(
    "PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT", "", "TRUE", "MAYBE_REQUIRED",
    "Is all of the user data collected by your app encrypted in transit?",
)

for rid, label in [
    ("PSL_ACM_USER_ID_PASSWORD", "Username and password"),
    ("PSL_ACM_USER_ID_OTHER_AUTH", "Username and other authentication"),
    ("PSL_ACM_USER_ID_PASSWORD_OTHER_AUTH", "Username, password, and other authentication"),
    ("PSL_ACM_OAUTH", "OAuth"),
    ("PSL_ACM_OTHER", "Other"),
    ("PSL_ACM_NONE", "My app does not allow users to create an account"),
]:
    add(
        "PSL_SUPPORTED_ACCOUNT_CREATION_METHODS", rid,
        "TRUE" if rid == "PSL_ACM_NONE" else "",
        "MULTIPLE_CHOICE",
        f"Which of the following methods of account creation does your app support? Select all that apply / {label}",
    )

add("PSL_ACM_SPECIFY", "", "", "MAYBE_REQUIRED", "Describe the method of account creation that your app supports")
add(
    "PSL_ACCOUNT_DELETION_URL", "", "", "MAYBE_REQUIRED",
    "Add a link that users can use to request that their account and associated data is deleted ",
)

for rid, label in [
    ("DATA_DELETION_YES", "Yes"),
    ("DATA_DELETION_NO", "No"),
    ("DATA_DELETION_NO_AUTO_DELETED", "No, but user data is automatically deleted within 90 days"),
]:
    add(
        "PSL_SUPPORT_DATA_DELETION_BY_USER", rid,
        "TRUE" if rid == "DATA_DELETION_YES" else "",
        "SINGLE_CHOICE",
        f"Do you provide a way for users to request that their data is deleted? / {label}",
    )

add(
    "PSL_DATA_DELETION_URL", "", "https://somafrik.app/suppression-compte", "MAYBE_REQUIRED",
    "Delete data URL",
)
add(
    "PSL_DATA_COLLECTION_COMPLIES_FAMILY_POLICY", "", "", "OPTIONAL",
    "Only answer this question if you've indicated that your app's target age group includes children, or you've opted into the Designed for Families program. If either of the above is true, you are required to follow the Google Play Families Policy (https://support.google.com/googleplay/android-developer/answer/9893335). Do you want to let users know about this commitment in the Data safety section on your store listing?",
)
add(
    "PSL_INDEPENDENTLY_VALIDATED", "", "", "OPTIONAL",
    'Has your app successfully completed an independent security review, according to the Mobile Application Security Assessment (MASA) framework? Only answer "yes" if the review is in good standing.',
)
add("PSL_UPI_BADGE_OPT_IN", "", "", "OPTIONAL", "Do you want to show this badge on your store listing?")
add("PSL_HAS_OUTSIDE_APP_ACCOUNTS", "", "TRUE", "OPTIONAL", "Can users login to your app with accounts created outside of the app?")

for rid, label in [
    ("PSL_LOGIN_WITH_OUTSIDE_APP_ID", "Out of app identification (e.g. SIM binding, service subscription)"),
    ("PSL_LOGIN_THROUGH_EMPLOYMENT_OR_ENTERPRISE_ACCOUNT", "Through employment, or enterprise accounts"),
    ("PSL_OUTSIDE_APP_ACCOUNT_TYPE_OTHER", "Other"),
]:
    add(
        "PSL_OUTSIDE_APP_ACCOUNT_TYPES", rid,
        "TRUE" if rid in {"PSL_LOGIN_THROUGH_EMPLOYMENT_OR_ENTERPRISE_ACCOUNT", "PSL_OUTSIDE_APP_ACCOUNT_TYPE_OTHER"} else "",
        "MULTIPLE_CHOICE",
        f"How are these accounts created? / {label}",
    )

add(
    "PSL_OUTSIDE_APP_ACCOUNT_TYPE_SPECIFY", "",
    "Accounts are created and provisioned by the user's school or educational institution, or by a Somafrik administrator. Staff accounts may also be assigned as part of employment.",
    "MAYBE_REQUIRED", "Describe how these accounts are created",
)

# The 38 data types in the current Play Console template.
DATA_TYPES = [
    ("PSL_DATA_TYPES_PERSONAL", "PSL_NAME", "Personal info / Name"),
    ("PSL_DATA_TYPES_PERSONAL", "PSL_EMAIL", "Personal info / Email address"),
    ("PSL_DATA_TYPES_PERSONAL", "PSL_USER_ACCOUNT", "Personal info / User IDs"),
    ("PSL_DATA_TYPES_PERSONAL", "PSL_ADDRESS", "Personal info / Address"),
    ("PSL_DATA_TYPES_PERSONAL", "PSL_PHONE", "Personal info / Phone number"),
    ("PSL_DATA_TYPES_PERSONAL", "PSL_RACE_ETHNICITY", "Personal info / Race and ethnicity"),
    ("PSL_DATA_TYPES_PERSONAL", "PSL_POLITICAL_RELIGIOUS", "Personal info / Political or religious beliefs"),
    ("PSL_DATA_TYPES_PERSONAL", "PSL_SEXUAL_ORIENTATION_GENDER_IDENTITY", "Personal info / Sexual orientation"),
    ("PSL_DATA_TYPES_PERSONAL", "PSL_OTHER_PERSONAL", "Personal info / Other info"),
    ("PSL_DATA_TYPES_FINANCIAL", "PSL_CREDIT_DEBIT_BANK_ACCOUNT_NUMBER", "Financial info / User payment info"),
    ("PSL_DATA_TYPES_FINANCIAL", "PSL_PURCHASE_HISTORY", "Financial info / Purchase history"),
    ("PSL_DATA_TYPES_FINANCIAL", "PSL_CREDIT_SCORE", "Financial info / Credit score"),
    ("PSL_DATA_TYPES_FINANCIAL", "PSL_OTHER", "Financial info / Other financial info"),
    ("PSL_DATA_TYPES_LOCATION", "PSL_APPROX_LOCATION", "Location / Approximate location"),
    ("PSL_DATA_TYPES_LOCATION", "PSL_PRECISE_LOCATION", "Location / Precise location"),
    ("PSL_DATA_TYPES_SEARCH_AND_BROWSING", "PSL_WEB_BROWSING_HISTORY", "Web browsing / Web browsing history"),
    ("PSL_DATA_TYPES_EMAIL_AND_TEXT", "PSL_EMAILS", "Messages / Emails"),
    ("PSL_DATA_TYPES_EMAIL_AND_TEXT", "PSL_SMS_CALL_LOG", "Messages / SMS or MMS"),
    ("PSL_DATA_TYPES_EMAIL_AND_TEXT", "PSL_OTHER_MESSAGES", "Messages / Other in-app messages"),
    ("PSL_DATA_TYPES_PHOTOS_AND_VIDEOS", "PSL_PHOTOS", "Photos and videos / Photos"),
    ("PSL_DATA_TYPES_PHOTOS_AND_VIDEOS", "PSL_VIDEOS", "Photos and videos / Videos"),
    ("PSL_DATA_TYPES_AUDIO", "PSL_AUDIO", "Audio files / Voice or sound recordings"),
    ("PSL_DATA_TYPES_AUDIO", "PSL_MUSIC", "Audio files / Music files"),
    ("PSL_DATA_TYPES_AUDIO", "PSL_OTHER_AUDIO", "Audio files / Other audio files"),
    ("PSL_DATA_TYPES_HEALTH_AND_FITNESS", "PSL_HEALTH", "Health and fitness / Health info"),
    ("PSL_DATA_TYPES_HEALTH_AND_FITNESS", "PSL_FITNESS", "Health and fitness / Fitness info"),
    ("PSL_DATA_TYPES_CONTACTS", "PSL_CONTACTS", "Contacts / Contacts"),
    ("PSL_DATA_TYPES_CALENDAR", "PSL_CALENDAR", "Calendar / Calendar events"),
    ("PSL_DATA_TYPES_APP_PERFORMANCE", "PSL_CRASH_LOGS", "App info and performance / Crash logs"),
    ("PSL_DATA_TYPES_APP_PERFORMANCE", "PSL_PERFORMANCE_DIAGNOSTICS", "App info and performance / Diagnostics"),
    ("PSL_DATA_TYPES_APP_PERFORMANCE", "PSL_OTHER_PERFORMANCE", "App info and performance / Other app performance data"),
    ("PSL_DATA_TYPES_FILES_AND_DOCS", "PSL_FILES_AND_DOCS", "Files and docs / Files and docs"),
    ("PSL_DATA_TYPES_APP_ACTIVITY", "PSL_USER_INTERACTION", "App activity / App interactions"),
    ("PSL_DATA_TYPES_APP_ACTIVITY", "PSL_IN_APP_SEARCH_HISTORY", "App activity / In-app search history"),
    ("PSL_DATA_TYPES_APP_ACTIVITY", "PSL_APPS_ON_DEVICE", "App activity / Installed apps"),
    ("PSL_DATA_TYPES_APP_ACTIVITY", "PSL_USER_GENERATED_CONTENT", "App activity / Other user-generated content"),
    ("PSL_DATA_TYPES_APP_ACTIVITY", "PSL_OTHER_APP_ACTIVITY", "App activity / Other actions"),
    ("PSL_DATA_TYPES_IDENTIFIERS", "PSL_DEVICE_ID", "Device or other IDs / Device or other IDs"),
]

# Current Somafrik declaration. Update only after auditing the actual release.
SELECTED = {
    "PSL_NAME",
    "PSL_EMAIL",
    "PSL_USER_ACCOUNT",
    "PSL_PHONE",
    "PSL_OTHER_PERSONAL",
    "PSL_PURCHASE_HISTORY",
    "PSL_OTHER",
    "PSL_OTHER_MESSAGES",
    "PSL_PHOTOS",
    "PSL_FILES_AND_DOCS",
    "PSL_OTHER_APP_ACTIVITY",
    "PSL_DEVICE_ID",
}

OPTIONAL_COLLECTION = {
    "PSL_EMAIL",
    "PSL_OTHER_MESSAGES",
    "PSL_PHOTOS",
    "PSL_FILES_AND_DOCS",
    "PSL_DEVICE_ID",
}

PURPOSES = {
    "PSL_NAME": {"PSL_APP_FUNCTIONALITY", "PSL_ACCOUNT_MANAGEMENT"},
    "PSL_EMAIL": {"PSL_APP_FUNCTIONALITY", "PSL_ACCOUNT_MANAGEMENT"},
    "PSL_USER_ACCOUNT": {"PSL_APP_FUNCTIONALITY", "PSL_ACCOUNT_MANAGEMENT", "PSL_FRAUD_PREVENTION_SECURITY"},
    "PSL_PHONE": {"PSL_APP_FUNCTIONALITY", "PSL_ACCOUNT_MANAGEMENT"},
    "PSL_OTHER_PERSONAL": {"PSL_APP_FUNCTIONALITY", "PSL_ACCOUNT_MANAGEMENT"},
    "PSL_PURCHASE_HISTORY": {"PSL_APP_FUNCTIONALITY"},
    "PSL_OTHER": {"PSL_APP_FUNCTIONALITY"},
    "PSL_OTHER_MESSAGES": {"PSL_APP_FUNCTIONALITY"},
    "PSL_PHOTOS": {"PSL_APP_FUNCTIONALITY"},
    "PSL_FILES_AND_DOCS": {"PSL_APP_FUNCTIONALITY"},
    "PSL_OTHER_APP_ACTIVITY": {"PSL_FRAUD_PREVENTION_SECURITY"},
    "PSL_DEVICE_ID": {"PSL_APP_FUNCTIONALITY", "PSL_DEVELOPER_COMMUNICATIONS"},
}

PURPOSE_OPTIONS = [
    ("PSL_APP_FUNCTIONALITY", "App functionality"),
    ("PSL_ANALYTICS", "Analytics"),
    ("PSL_DEVELOPER_COMMUNICATIONS", "Developer communications"),
    ("PSL_FRAUD_PREVENTION_SECURITY", "Fraud prevention, security, and compliance"),
    ("PSL_ADVERTISING", "Advertising or marketing"),
    ("PSL_PERSONALIZATION", "Personalization"),
    ("PSL_ACCOUNT_MANAGEMENT", "Account management"),
]

for group, code, label in DATA_TYPES:
    add(group, code, "TRUE" if code in SELECTED else "", "MULTIPLE_CHOICE", label)

for _, code, label in DATA_TYPES:
    friendly = label.split(" / ")[-1]
    selected = code in SELECTED

    q = f"PSL_DATA_USAGE_RESPONSES:{code}:PSL_DATA_USAGE_COLLECTION_AND_SHARING"
    add(q, "PSL_DATA_USAGE_ONLY_COLLECTED", "TRUE" if selected else "", "MULTIPLE_CHOICE",
        f"Data usage and handling ({friendly}) / Is this data collected, shared, or both? / Collected")
    add(q, "PSL_DATA_USAGE_ONLY_SHARED", "", "MULTIPLE_CHOICE",
        f"Data usage and handling ({friendly}) / Is this data collected, shared, or both? / Shared")

    add(
        f"PSL_DATA_USAGE_RESPONSES:{code}:PSL_DATA_USAGE_EPHEMERAL", "",
        "FALSE" if selected else "", "MAYBE_REQUIRED",
        f"Data usage and handling ({friendly}) / Is this data processed ephemerally?",
    )

    q_control = f"PSL_DATA_USAGE_RESPONSES:{code}:DATA_USAGE_USER_CONTROL"
    add(
        q_control, "PSL_DATA_USAGE_USER_CONTROL_OPTIONAL",
        "TRUE" if selected and code in OPTIONAL_COLLECTION else "", "SINGLE_CHOICE",
        f"Data usage and handling ({friendly}) / Is this data required for your app, or can users choose whether it's collected? / Users can choose whether this data is collected",
    )
    add(
        q_control, "PSL_DATA_USAGE_USER_CONTROL_REQUIRED",
        "TRUE" if selected and code not in OPTIONAL_COLLECTION else "", "SINGLE_CHOICE",
        f"Data usage and handling ({friendly}) / Is this data required for your app, or can users choose whether it's collected? / Data collection is required (users can't turn off this data collection)",
    )

    for rid, purpose_label in PURPOSE_OPTIONS:
        add(
            f"PSL_DATA_USAGE_RESPONSES:{code}:DATA_USAGE_COLLECTION_PURPOSE", rid,
            "TRUE" if selected and rid in PURPOSES.get(code, set()) else "", "MULTIPLE_CHOICE",
            f"Data usage and handling ({friendly}) / Why is this user data collected? Select all that apply. / {purpose_label}",
        )

    for rid, purpose_label in PURPOSE_OPTIONS:
        add(
            f"PSL_DATA_USAGE_RESPONSES:{code}:DATA_USAGE_SHARING_PURPOSE", rid, "", "MULTIPLE_CHOICE",
            f"Data usage and handling ({friendly}) / Why is this user data shared? Select all that apply. / {purpose_label}",
        )

if len(DATA_TYPES) != 38:
    raise SystemExit(f"Template drift: expected 38 data types, got {len(DATA_TYPES)}")

if len(rows) + 1 != EXPECTED_ROWS_WITH_HEADER:
    raise SystemExit(f"Template drift: expected {EXPECTED_ROWS_WITH_HEADER} CSV lines, got {len(rows) + 1}")

for code in SELECTED:
    relevant = [row for row in rows if f":{code}:" in row[0]]
    if not any(row[1] == "PSL_DATA_USAGE_ONLY_COLLECTED" and row[2] == "TRUE" for row in relevant):
        raise SystemExit(f"Missing collected answer for {code}")
    if not any(row[3] == "SINGLE_CHOICE" and row[2] == "TRUE" for row in relevant):
        raise SystemExit(f"Missing user-control answer for {code}")
    if not any("COLLECTION_PURPOSE" in row[0] and row[2] == "TRUE" for row in relevant):
        raise SystemExit(f"Missing purpose for {code}")

with OUTPUT.open("w", encoding="utf-8", newline="") as handle:
    writer = csv.writer(handle, lineterminator="\r\n")
    writer.writerow(HEADER)
    writer.writerows(rows)

print(f"Generated {OUTPUT} ({len(rows) + 1} lines, {len(SELECTED)} declared data types)")
