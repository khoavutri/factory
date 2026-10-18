import type { ThemeConfig } from 'antd';

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#4f46e5',
    colorInfo: '#4f46e5',
    colorSuccess: '#2f9e44',
    colorWarning: '#e8930c',
    colorError: '#d64545',
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    controlHeight: 34,
  },
  components: {
    Layout: {
      siderBg: '#1e1b4b',
      triggerBg: '#181445',
      headerBg: '#ffffff',
      bodyBg: '#f4f5fa',
    },
    Menu: {
      darkItemBg: '#1e1b4b',
      darkSubMenuItemBg: '#181445',
      darkItemSelectedBg: '#4f46e5',
      darkItemColor: 'rgba(255,255,255,0.82)',
      darkItemHoverColor: '#ffffff',
    },
    Table: {
      headerBg: '#eff0f8',
      headerColor: '#3b3a63',
      rowHoverBg: '#f3f2fd',
    },
    Card: {
      headerFontSize: 15,
    },
    Statistic: {
      contentFontSize: 24,
    },
  },
};
