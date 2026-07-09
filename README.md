# Website Visitor Counter — AWS Lambda + DynamoDB

A beginner-friendly serverless mini project. A static website displays a live visitor count. Every page load calls an API Gateway endpoint, which invokes an AWS Lambda function that atomically increments a counter in DynamoDB and returns the latest total.

> **Note:** This project is for demonstration and learning purposes only.

---

## Project Overview

**Two pages:**

- **`visit.html` — the tracked page.** Every visit increments the counter (like a real website page with analytics).
- **`index.html` — the dashboard.** Displays the total count *without* incrementing it (calls the API with `?mode=read`).

**How it works:**

1. A visitor opens `visit.html`.
2. JavaScript (`script.js`) calls the API Gateway endpoint using `fetch()`.
3. API Gateway invokes the Lambda function.
4. Lambda performs an atomic `ADD visits :inc` update on the DynamoDB table (creating the item automatically if it doesn't exist).
5. Lambda returns `{ "visits": <number> }`.
6. The page displays the updated count (or **Counter unavailable** if the API fails).
7. Opening `index.html` shows the same count read-only — refreshing the dashboard never inflates the number.

**AWS services used:** API Gateway (HTTP API), Lambda (Python 3.12), DynamoDB, S3 (optional static hosting).

---

## Architecture

```
Visitor
    |
    v
Static HTML Website  (local or S3)
    |
    v
Amazon API Gateway  (HTTP API — GET /visitor-count)
    |
    v
AWS Lambda  (Python 3.12)
    |
    v
Amazon DynamoDB  (WebsiteVisitorCounter table)
```

---

## Folder Structure

```
visitor-counter/
│
├── frontend/
│   ├── index.html          # Dashboard — shows count (read-only)
│   ├── visit.html          # Tracked page — visiting increments count
│   ├── styles.css          # Responsive, modern card UI
│   └── script.js           # Shared logic for both pages
│
├── lambda/
│   ├── lambda_function.py  # Lambda handler (Python 3.12)
│   └── iam-policy.json     # Least-privilege inline policy for the table
│
├── README.md
│
└── .gitignore
```

---

## Prerequisites

- An AWS account ([sign up here](https://aws.amazon.com/free/))
- Basic familiarity with the AWS Console
- A modern web browser
- (Optional) Python 3 installed locally, only for running `python -m http.server`

No Docker, Terraform, CloudFormation, SAM, CDK, or frameworks required.

---

## AWS Setup

Deploy the backend in this order:

1. Create the DynamoDB table
2. Create the Lambda function
3. Attach the IAM policy
4. Create the API Gateway HTTP API
5. Wire the API URL into the frontend

All steps use the AWS Console. Keep everything in the **same region** (e.g., `us-east-1`).

---

## Step 1 — DynamoDB Table

1. Open the **DynamoDB** console → **Create table**.
2. **Table name:** `WebsiteVisitorCounter`
3. **Partition key:** `counterId` — type **String**
4. Leave all other settings at their defaults (on-demand capacity is fine).
5. Click **Create table**.

You do **not** need to create the counter item manually. The Lambda's atomic `ADD` expression creates it automatically on the first request:

```json
{
    "counterId": "main",
    "visits": 1
}
```

---

## Step 2 — Lambda Function

1. Open the **Lambda** console → **Create function**.
2. Choose **Author from scratch**.
3. **Function name:** `visitorCounterFunction`
4. **Runtime:** **Python 3.12**
5. Under **Permissions**, keep *Create a new role with basic Lambda permissions*.
6. Click **Create function**.
7. In the **Code** tab, replace the default code with the contents of `lambda/lambda_function.py`.
8. Click **Deploy**.

**Quick test:** In the **Test** tab, create a test event with an empty JSON object `{}` and run it. Expected response:

```json
{
    "statusCode": 200,
    "headers": { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    "body": "{\"visits\": 1}"
}
```

(The first test will fail with an AccessDenied error until you complete Step 3.)

---

## Step 3 — IAM Policy

Grant the Lambda role least-privilege access to the table:

1. In your Lambda function, open **Configuration → Permissions** and click the **execution role** name (opens the IAM console).
2. Click **Add permissions → Create inline policy**.
3. Switch to the **JSON** tab and paste the contents of `lambda/iam-policy.json`.
4. Replace `REGION` and `ACCOUNT_ID` in the `Resource` ARN with your values, e.g.:

```
arn:aws:dynamodb:us-east-1:123456789012:table/WebsiteVisitorCounter
```

5. Click **Next**, name the policy `VisitorCounterDynamoDBPolicy`, and click **Create policy**.

The policy allows only `dynamodb:GetItem`, `dynamodb:UpdateItem`, and `dynamodb:PutItem` on the `WebsiteVisitorCounter` table — nothing else.

---

## Step 4 — API Gateway (HTTP API)

1. Open the **API Gateway** console → **Create API** → **HTTP API** → **Build**.
2. **Add integration:** choose **Lambda** and select `visitorCounterFunction`.
3. **API name:** `visitor-counter-api`
4. **Configure routes:** Method **GET**, Resource path `/visitor-count`.
5. Keep the default `$default` stage with auto-deploy, then **Create**.

### Enable CORS

1. In your API, open **CORS** in the left menu → **Configure**.
2. Set:
   - **Access-Control-Allow-Origin:** `*`
   - **Access-Control-Allow-Methods:** `GET`, `OPTIONS`
   - **Access-Control-Allow-Headers:** `content-type`
3. Click **Save**.

### Get your invoke URL

Copy the **Invoke URL** from the API overview page. Your full endpoint is:

```
https://<api-id>.execute-api.<region>.amazonaws.com/visitor-count
```

Test it in a browser or with curl — each request should increment the count:

```bash
curl https://<api-id>.execute-api.<region>.amazonaws.com/visitor-count
# {"visits": 2}
```

---

## Step 5 — Connect the Frontend

Open `frontend/script.js` and replace the placeholder:

```javascript
const API_URL = "PASTE_API_GATEWAY_URL";
```

with your real endpoint:

```javascript
const API_URL = "https://<api-id>.execute-api.<region>.amazonaws.com/visitor-count";
```

---

## S3 Static Website Hosting (Optional)

To host the frontend publicly on S3:

1. Open the **S3** console → **Create bucket** (e.g., `my-visitor-counter-site`). Bucket names must be globally unique.
2. Uncheck **Block all public access** and acknowledge the warning.
3. Upload `index.html`, `visit.html`, `styles.css`, and `script.js` from the `frontend/` folder.
4. In **Properties → Static website hosting**, click **Edit**:
   - **Enable** static website hosting
   - **Index document:** `index.html`
5. In **Permissions → Bucket policy**, add (replace the bucket name):

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::my-visitor-counter-site/*"
        }
    ]
}
```

6. Open the **Bucket website endpoint** shown under Static website hosting.

---

## Testing Locally

Only the frontend runs locally — the backend stays on AWS.

**Option A — open directly:**

Double-click `frontend/index.html` (or drag it into a browser).

**Option B — simple local server:**

```bash
cd frontend
python -m http.server
```

Then open [http://localhost:8000](http://localhost:8000).

- Open **visit.html** and refresh — each refresh increments the counter by 1.
- Open **index.html** (the dashboard) and refresh — the count stays the same; it only displays the total.

You can also test both modes directly with curl:

```bash
curl "https://<api-id>.execute-api.<region>.amazonaws.com/visitor-count"            # increments
curl "https://<api-id>.execute-api.<region>.amazonaws.com/visitor-count?mode=read"  # read-only
```

If the API URL is missing or the request fails, the page shows **Counter unavailable**.

---

## Screenshots

*(Add your screenshots here)*

| Screenshot | Description |
|---|---|
| `![Homepage](screenshots/homepage.png)` | Webpage showing the visitor count |
| `![DynamoDB](screenshots/dynamodb-item.png)` | Counter item in the DynamoDB table |
| `![Lambda](screenshots/lambda-test.png)` | Successful Lambda test invocation |
| `![API Gateway](screenshots/api-gateway.png)` | HTTP API route configuration |

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| **Counter unavailable** on the page | `API_URL` still set to the placeholder | Paste your real invoke URL into `script.js` |
| CORS error in browser console | CORS not configured on the HTTP API | Configure CORS (Step 4) with origin `*` and methods `GET, OPTIONS` |
| `AccessDeniedException` in Lambda logs | Missing IAM policy | Attach the inline policy from Step 3 to the Lambda execution role |
| `ResourceNotFoundException` | Table name or region mismatch | Ensure the table is named `WebsiteVisitorCounter` and is in the same region as the Lambda |
| Count doesn't increase | Browser caching the GET response | Hard-refresh (Ctrl+Shift+R); each request should hit the API |
| `{"message":"Not Found"}` from the API | Wrong path | Use the full path `/visitor-count` after the invoke URL |
| Lambda test works but browser fails | Testing bypasses API Gateway | Check the API Gateway route, integration, and CORS settings |

**Where to look for logs:** CloudWatch → Log groups → `/aws/lambda/visitorCounterFunction`.

---

## Future Improvements

- Count unique visitors (by hashed IP or cookie) instead of raw page loads
- Add CloudFront + HTTPS custom domain in front of the S3 site
- Add API throttling / rate limiting to prevent abuse
- Track daily/monthly visit statistics with additional DynamoDB items
- Add a CI/CD pipeline (e.g., GitHub Actions) to deploy Lambda updates
- Display a small chart of visits over time on the frontend

---

## Cost

All services used fall within the AWS Free Tier for light usage: 1M Lambda requests, 1M HTTP API calls, and 25 GB of DynamoDB storage per month. A demo project like this typically costs **$0**.

---

## License

Free to use for learning and demonstration purposes.
