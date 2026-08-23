Auth is a session cookie, not a JWT. The cookie holds an opaque random id; the session data lives in Redis. This costs one Redis lookup per request, but means a session can be revoked instantly  a JWT stays valid until it expires.



### Auth
Method	Path	            Auth	        Purpose
POST	/api/auth/login	    none	        Email + password → sets __Host-sid cookie
POST	/api/auth/logout	session	        Deletes the Redis session
GET	    /api/auth/me	    session	        Who am I — dashboard calls this on load

No signup route. Tenants are admin-provisioned by seed script — say that explicitly, an absence is a decision.

### Students
Method	Path	                    Auth	Purpose
GET	    /api/students	            both	List, filter by class_label, paginated
POST	/api/students	            both	Add a student
GET	    /api/students/:id	        both	One student
PATCH	/api/students/:id	        both	Update name, class
GET	    /api/students/:id/balance	both	From student_balances view
GET	    /api/students/:id/ledger	both	Charges, payments, adjustments in order

### Guardians
Method	Path	                                Auth	Purpose
GET	    /api/guardians	                        both	List
POST	/api/guardians	                        both	Register a parent (normalise MSISDN here)
POST	/api/guardians/:id/students	            both	Link to a child
DELETE	/api/guardians/:id/students/:studentId	both	Unlink
POST	/api/guardians/:id/reset-pin	        both	Clears pin_hash, unlocks, writes audit row

### Fees and charges
Method	Path	Auth	Purpose
GET	/api/fee-items	both	List, filter by category
POST	/api/fee-items	both	Create
PATCH	/api/fee-items/:id	both	Edit or deactivate
POST	/api/charges	both	Assign a fee to one student
POST	/api/charges/bulk	both	Assign to a whole class

### Payments

Method	Path	                    Auth	Purpose
GET	    /api/payments	            both	List, filter by status and date
GET	    /api/payments/unmatched	    both	The orphan queue (student_id IS NULL)
PATCH	/api/payments/:id/assign	both	Attach an orphan to a student
POST	/api/payments/:id/allocate	both	Split across charges
GET	    /api/payments/:id/receipt	both	PDF

### Adjustments — manager only
Method	Path	            Auth	    Purpose
POST	/api/adjustments	manager	    Waiver, bursary, reversal, correction
GET	    /api/adjustments	both	    List with reasons and actors

### Staff and payroll
Method	Path	                    Auth	    Purpose
GET	    /api/staff	                both	    List
POST	/api/staff	                manager	    Add — salary is money
PATCH	/api/staff/:id	            manager	    Change salary or deactivate
GET	    /api/payroll	            both	    Runs by period
GET	    /api/payroll/:id	        both	    One run plus its lines
POST	/api/payroll/:id/approve	manager	    draft → approved, stamps approved_by
POST	/api/payroll/:id/mark-paid	manager	    approved → paid, stamps paid_by, queues notifications

Two separate endpoints because approving and confirming payment are two separate acts. That's your separation of duties in the API surface.

### Announcements and audit
Method	Path	                            Auth	    Purpose
GET	    /api/announcements	                both	       List
POST	/api/announcements	                both	    Create and queue deliveries
GET	    /api/announcements/:id/deliveries	both	    The tick list with per-parent status
GET	    /api/audit-logs	                    manager	    Filter by action, actor, target

### Live updates
Method	Path	                    Auth	Purpose
GET	    /api/events	                session	        SSE stream — payments appear without refresh


### Webhooks — no session, but not unprotected
Method	Path	Verified by
POST	/webhook/mpesa/callback	    HMAC on raw body, before JSON parsing
POST	/webhook/ussd	            Africa's Talking source, tenant from 3-digit code
POST	/webhook/whatsapp	        Meta signature, tenant from recipient number
GET	    /webhook/whatsapp	        Meta's one-time verification challenge