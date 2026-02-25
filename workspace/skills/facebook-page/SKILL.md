# 📘 Facebook Page Skill

Manage your Facebook Page directly from Adytum. This skill allows the agent to post updates, upload photos, list recent posts, and manage comments on your page.

## 🛠 Setup Instructions

To use this skill, you need a **Facebook Page Access Token** and your **Page ID**.

### 1. Get your Page ID

1. Go to your Facebook Page.
2. Click **Settings & Privacy** > **Settings**.
3. Go to **About** > **Page Transparency**.
4. Your **Page ID** is listed there.

### 2. Generate a Page Access Token

1. Go to the [Meta for Developers](https://developers.facebook.com/) portal.
2. Create a new App (type: **Business** or **Other**).
3. Add **Facebook Login for Business** to your app.
4. Use the [Graph API Explorer](https://developers.facebook.com/tools/explorer/) to generate a token:
   - Select your App.
   - For **User or Page**, select your Page.
   - Add permissions: `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`.
   - Click **Generate Token**.
5. Exchange this short-lived token for a **Long-lived Page Access Token** in the [Access Token Tool](https://developers.facebook.com/tools/accesstoken/).

### 3. Configure in Adytum

1. Open the Adytum Dashboard.
2. Go to **Skills** > **Facebook Page**.
3. Enter your **Page ID** and **Page Access Token**.
4. Click **Save**.

## 🧰 Tools Included

- `facebook_post`: Post a text update to your page feed.
- `facebook_post_photo`: Upload a photo with a caption to your page.
- `facebook_list_posts`: See your latest published posts and their IDs.
- `facebook_list_comments`: Retrieve comments for a specific post.
- `facebook_post_comment`: Reply to a comment or add a new one to a post.

## 💡 Example Prompts

- "Post 'Excited to announce our new project!' to my Facebook Page."
- "List the last 5 posts on my Facebook Page."
- "Are there any new comments on my latest post?"
- "Reply to the comment from John Doe on my last post saying 'Thanks for the support!'"
