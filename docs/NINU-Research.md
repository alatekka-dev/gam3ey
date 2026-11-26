# New Ismailia National University (NINU) – background research for GAM3EY

Research date: 26 November 2026. Every fact below is taken from the sources listed at the end. Where sources disagree, this is stated and the fact is **not** used in the platform.

## 1. University profile

| Item | Finding | Source |
|---|---|---|
| Official name | جامعة الإسماعيلية الجديدة الأهلية – New Ismailia National University (NINU) | [1], [2] |
| Legal basis | Presidential Decree No. 427 of 2022 | [2] |
| Origin | National university that emerged from Suez Canal University; first phase relied on Suez Canal University staff | [1], [3] |
| Location | New Ismailia City, east bank of the Suez Canal; campus of 29 feddans (≈121,800 m²) | [1], [2] |
| Start of study | October 2022 | [1] |
| Study system | Credit-hour system | [1] |
| Size (site counters) | 8 faculties, 9 programs, 3 academic sectors, 6 workshops and labs | [1] |
| Contact | +20 64 3200125, president@ninu.edu.eg, inquiries and complaints page | [1] |

## 2. Faculties and programs (official website)

| Faculty | Programs |
|---|---|
| Medicine | Bachelor of Medicine and Surgery |
| Dentistry | Bachelor of Oral and Dental Medicine and Surgery |
| Pharmacy | Bachelor of Pharmacy (Pharm D) |
| Nursing | Bachelor of Nursing Science |
| Physical Therapy | Bachelor of Physical Therapy |
| Engineering | Electrical Engineering – **Artificial Intelligence Engineering**; Civil Engineering – Construction Engineering and Project Management |
| International Trade and Languages | Digital Marketing and E-Business; Markets and Financial Institutions; specialised translation (English, German, Chinese) |
| Applied Health Sciences Technology | **Healthcare Services Management and Informatics**; Medical Laboratory Technology |

News reports mention that the university council approved new faculties (Computer Science, Al-Alsun, Mass Communication, Life Sciences) [4]. This could not be confirmed on the official site, so it is not used.

## 3. Current digital services – evidence for the problem statement

The official website links students to several separate systems [1]:

| Service | Where it is today |
|---|---|
| Electronic services (main) | Portal hosted on the Suez Canal University MIS domain (`es-mis.suez.edu.eg`) |
| Online registration | Separate page on a raw IP address over plain HTTP |
| Medical examination | Separate page on the Suez Canal University MIS domain |
| Student identification form | Separate page on a raw IP address over plain HTTP |
| Academic email | Separate login on a raw IP address over plain HTTP |

**What this means for GAM3EY**

1. Students reach university services through **at least five different entry points on more than one domain**. This directly supports the project's problem statement: information and services are scattered.
2. Some entry points use **unencrypted HTTP on raw IP addresses**. GAM3EY's design (single HTTPS origin, hashed passwords, expiring reset links, role isolation, audit log) addresses this. That is a measurable improvement the report can state.
3. The website lists no learning management system, campus map, notifications service, or team-formation tool. These are the parts of GAM3EY that add new value rather than duplicating existing systems.
4. Because NINU's systems are run by Suez Canal University, a real integration would go through the Suez Canal University MIS. The report states this as a future integration (single sign-on and a read-only data feed), not as something already done.

## 4. What was added to the platform from this research

- University identity: logo, colours taken from the logo (navy, gold, green, sea blue), campus photographs, name in Arabic and English.
- Demo students now belong to real NINU programs (AI Engineering, Healthcare Services Management and Informatics, Digital Marketing and E-Business).
- Six **verified** campus-guide articles (about the university, faculties and programs, admission, fees policy, electronic services, contact), each citing its official source and review date.
- An About page with quick facts and links to the official website, the current e-services portal, the complaints page, and the Council of National Universities page.

## 5. Facts deliberately not used

- **Tuition figures.** News sites publish conflicting numbers for 2026/2027 (for example, Dentistry 135,000 vs 150,000 EGP) [5], [6]. The only official article is from 2022. The platform only says fees are approved yearly and directs students to the official announcement.
- **Campus layout.** No official campus map is published, so the platform's map stays a clearly labelled demo layout.
- **Faculty for the graduation team.** The team's own faculty and department are not stated here. They must be filled in on the report cover.

## Sources

1. New Ismailia National University – official website: https://ninu.edu.eg/ (home page, program and fees announcements; read 26 Nov 2026)
2. Council of National Universities – New Ismailia National University: https://cnu.mohesr.gov.eg/new-ismailia
3. Al-Ahram Gate, cabinet approval of national universities (Aug 2022): https://gate.ahram.org.eg/News/3636158.aspx
4. Elbalad, new faculties at Ismailia National University: https://www.elbalad.news/6060097
5. Masrawy, NINU fees 2026/2027 (13 Jul 2026): https://www.masrawy.com/news/education-universityeducation/details/2026/7/13/3017255/
6. Dar Al-Maaref, NINU fees and coordination 2026: https://daralmaref.com/News/2569489.aspx
