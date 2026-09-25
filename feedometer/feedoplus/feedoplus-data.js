/**
 * FeedO+ (RSS+) — Curated Community Intelligence Data
 * Category and Subreddit RSS Endpoints
 */
(function (global) {
  'use strict';

  const FEEDOPLUS_CATEGORIES = [
    {
      id: 'ai',
      name: 'Artificial Intelligence',
      icon: '🤖',
      items: [
        { name: 'r/OpenAI', url: 'https://www.reddit.com/r/OpenAI/.rss', desc: 'OpenAI models, ChatGPT, GPT-4o & research' },
        { name: 'r/LocalLLaMA', url: 'https://www.reddit.com/r/LocalLLaMA/.rss', desc: 'Open source LLMs, quantized weights & local AI' },
        { name: 'r/MachineLearning', url: 'https://www.reddit.com/r/MachineLearning/.rss', desc: 'Academic ML research, papers & developments' },
        { name: 'r/artificial', url: 'https://www.reddit.com/r/artificial/.rss', desc: 'General AI news, ethics, philosophy & trends' },
        { name: 'r/singularity', url: 'https://www.reddit.com/r/singularity/.rss', desc: 'AGI, exponential technology & future breakthroughs' }
      ]
    },
    {
      id: 'technology',
      name: 'Technology & Dev',
      icon: '💻',
      items: [
        { name: 'r/programming', url: 'https://www.reddit.com/r/programming/.rss', desc: 'Software engineering, architecture & code' },
        { name: 'r/webdev', url: 'https://www.reddit.com/r/webdev/.rss', desc: 'Frontend, backend, APIs & modern web standards' },
        { name: 'r/python', url: 'https://www.reddit.com/r/python/.rss', desc: 'Python libraries, ecosystem & data science' },
        { name: 'r/javascript', url: 'https://www.reddit.com/r/javascript/.rss', desc: 'JavaScript, TypeScript, React & Node.js' },
        { name: 'r/devops', url: 'https://www.reddit.com/r/devops/.rss', desc: 'Cloud infrastructure, CI/CD, Kubernetes & Docker' },
        { name: 'r/linux', url: 'https://www.reddit.com/r/linux/.rss', desc: 'Linux kernel, distros, open source & sysadmin' },
        { name: 'r/technology', url: 'https://www.reddit.com/r/technology/.rss', desc: 'Major tech industry news & global policy' }
      ]
    },
    {
      id: 'startups',
      name: 'Startups & Founders',
      icon: '🚀',
      items: [
        { name: 'r/startups', url: 'https://www.reddit.com/r/startups/.rss', desc: 'Building, scaling, launching & funding startups' },
        { name: 'r/Entrepreneur', url: 'https://www.reddit.com/r/Entrepreneur/.rss', desc: 'Business creation, hustle & founder insights' },
        { name: 'r/SaaS', url: 'https://www.reddit.com/r/SaaS/.rss', desc: 'Software-as-a-Service growth, pricing & churn' },
        { name: 'r/indiehackers', url: 'https://www.reddit.com/r/indiehackers/.rss', desc: 'Bootstrapping profitable online businesses' }
      ]
    },
    {
      id: 'business',
      name: 'Business & Marketing',
      icon: '📈',
      items: [
        { name: 'r/business', url: 'https://www.reddit.com/r/business/.rss', desc: 'Global commerce, enterprise & industry analysis' },
        { name: 'r/marketing', url: 'https://www.reddit.com/r/marketing/.rss', desc: 'Growth marketing, SEO, campaigns & brand strategy' },
        { name: 'r/sales', url: 'https://www.reddit.com/r/sales/.rss', desc: 'B2B sales pipelines, closing & SaaS outreach' }
      ]
    },
    {
      id: 'finance',
      name: 'Finance & Markets',
      icon: '💰',
      items: [
        { name: 'r/investing', url: 'https://www.reddit.com/r/investing/.rss', desc: 'Long-term equity, index funds & market trends' },
        { name: 'r/stocks', url: 'https://www.reddit.com/r/stocks/.rss', desc: 'Daily market movements, earnings & company news' },
        { name: 'r/securityanalysis', url: 'https://www.reddit.com/r/securityanalysis/.rss', desc: 'Deep fundamental value investing & reports' },
        { name: 'r/Economics', url: 'https://www.reddit.com/r/Economics/.rss', desc: 'Macroeconomics, interest rates & fiscal policy' }
      ]
    }
  ];

  global.FEEDOPLUS_DATA = {
    categories: FEEDOPLUS_CATEGORIES
  };
})(typeof window !== 'undefined' ? window : this);
