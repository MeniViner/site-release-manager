export const DEFAULT_SAMPLE_ADMIN_USERS = [
    {
        id: 1,
        name: 'מנהל לדוגמה',
        role: 'admin',
        personalNumber: '8856096',
        email: '',
        loginName: '',
    },
    {
        id: 2,
        name: 'מנהל ראשי',
        role: 'admin',
        personalNumber: '8624034',
        email: '',
        loginName: '',
    },
];

export const cloneDefaultSampleAdminUsers = () =>
    DEFAULT_SAMPLE_ADMIN_USERS.map((user) => ({ ...user }));
