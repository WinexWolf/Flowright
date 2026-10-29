# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - navigation "Primary" [ref=e3]:
      - link "Dashboard" [ref=e4] [cursor=pointer]:
        - /url: "#/"
      - link "Tasks" [ref=e5] [cursor=pointer]:
        - /url: "#/tasks"
      - link "Projects" [ref=e6] [cursor=pointer]:
        - /url: "#/projects"
      - link "Settings" [ref=e7] [cursor=pointer]:
        - /url: "#/settings"
      - link "Reports" [ref=e8] [cursor=pointer]:
        - /url: "#/reports"
  - main [ref=e9]:
    - heading "Design settings page" [level=1] [ref=e10]
    - paragraph [ref=e11]: Tabs for profile and alerts.
    - paragraph [ref=e12]: "Status: Done · Priority: low"
    - button "Mark as open" [ref=e13]
    - button "Edit" [ref=e14]
    - paragraph [ref=e15]:
      - link "Back to tasks" [ref=e16] [cursor=pointer]:
        - /url: "#/tasks"
  - status
```