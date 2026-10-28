// SPDX-License-Identifier: AGPL-3.0-only
// Account-only draft. Adoption and legal coverage are not established.
// This string-only object is authored in RFC 8785 key order; arrays retain their order.
const content = {
  "id": "nonverba-account-terms",
  "sections": [
    {
      "paragraphs": [
        "These proposed terms cover creating, accessing and managing a Non-verba account. They are a draft for review, not an adopted public-service agreement. Non-verba is the application name; the contracting operator, supported countries and eligibility requirements have not yet been settled.",
        "If you agree during development, the record identifies this draft only. It does not establish legal approval, public availability or agreement to a future version."
      ],
      "title": "Draft and scope"
    },
    {
      "paragraphs": [
        "Use an available username that does not impersonate another person or misrepresent your authority. Provide information you are entitled to use, including an email address you control, and complete the required confirmation process.",
        "Email confirmation establishes the account's contact status. It does not verify legal identity, qualifications or authority to act for another person or organization."
      ],
      "title": "Your account details"
    },
    {
      "paragraphs": [
        "One account can include both Requester and Operator roles. Having either role does not itself create an Assignment, authorize a signature or payment, approve union participation, or permit access to another person's records.",
        "Work, paid services, settlement and other consequential actions require their own information, agreements and permissions. Account creation does not place an order or accept a paid Assignment."
      ],
      "title": "Account access and separate actions"
    },
    {
      "paragraphs": [
        "Protect your password and recovery material. Do not share credentials, impersonate others, gain unauthorized access, misuse another person's information, or interfere with the service or its users. If you suspect compromise, stop using the affected credentials and use the recovery or support options made available to you."
      ],
      "title": "Security and responsible use"
    },
    {
      "paragraphs": [
        "Account creation involves account details, credential and security records, and a record of the terms you agreed to. A separate Privacy Notice must identify the responsible organization and explain purposes, recipients, retention and applicable rights before public use.",
        "Agreement to these terms is not blanket consent to identity-document or face processing, sensor access, marketing or public profile publication. Those actions require their own information and deliberate choices."
      ],
      "title": "Account data and privacy"
    },
    {
      "paragraphs": [
        "You may stop using the account. Signing out leaves the account open. Closing the account signs you out and stops its sessions, keys and recovery codes. The account record stays for a retention period, together with the information kept for that account, so the account can still be found if information about it is required. The same email can be used for a new account, and that new account receives its own record.",
        "Access restrictions and account closure do not by themselves cancel separate agreements or change another party's rights. The length of the retention period, and the operator's security, suspension, complaint and review procedures, must be specified before public adoption."
      ],
      "title": "Leaving, closure and restrictions"
    },
    {
      "paragraphs": [
        "The record of agreement must identify the exact version and full text presented when you deliberately agreed. Editing or publishing a later version does not rewrite that record.",
        "Any request to agree to revised terms must identify the new version and make its full text available. Agreement to this draft does not automatically accept later terms."
      ],
      "title": "Versions and your agreement record"
    },
    {
      "paragraphs": [
        "These draft terms do not remove rights that cannot lawfully be excluded. They select no governing law, dispute forum or territorial coverage. The operator and applicable legal requirements must be reviewed before an adopted agreement is offered."
      ],
      "title": "Rights and adoption"
    }
  ],
  "status": "draft",
  "title": "Account Terms and Conditions (Draft)",
  "version": "0.1.0-draft.2"
};

for (const section of content.sections) {
  Object.freeze(section.paragraphs);
  Object.freeze(section);
}
Object.freeze(content.sections);
Object.freeze(content);

// SHA-256 covers exactly the UTF-8 bytes of this JSON, with no BOM or trailing LF.
// The digest and transport-format fields are outside the content being hashed.
export const ACCOUNT_TERMS_CONTENT_JSON = JSON.stringify(content);
export const ACCOUNT_TERMS_CONTENT_FORMAT = 'nonverba-account-terms-jcs-v1';
export const ACCOUNT_TERMS_CONTENT_SHA256 = '6fa35455cdd833e3253f44dbcf7cfb9b61342d2d22fd99a6318996433c7d60a7';
export const ACCOUNT_TERMS = Object.freeze({...content, contentSha256: ACCOUNT_TERMS_CONTENT_SHA256});

