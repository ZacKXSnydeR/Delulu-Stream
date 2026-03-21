import { createContext, useState, useEffect, useContext, ReactNode } from 'react';

// Define the shape of our profile data
export interface UserProfile {
    name: string;
    avatarUrl: string;
}

// Define the shape of our context
interface UserProfileContextType {
    profile: UserProfile;
    updateProfile: (name: string, avatarUrl: string) => void;
}

// Default generic physical fallback
const defaultProfile: UserProfile = {
    name: 'Local User',
    avatarUrl: '' // Empty means we will render the letter 'L' fallback
};

// Create Context
const UserProfileContext = createContext<UserProfileContextType | undefined>(undefined);

// Storage Key
const PROFILE_STORAGE_KEY = 'delulu-local-profile';

// Provider Component
export function UserProfileProvider({ children }: { children: ReactNode }) {
    const [profile, setProfile] = useState<UserProfile>(defaultProfile);

    // Load from localStorage on mount
    useEffect(() => {
        const storedProfile = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (storedProfile) {
            try {
                setProfile(JSON.parse(storedProfile));
            } catch (e) {
                console.error("Failed to parse local profile data", e);
            }
        }
    }, []);

    // Update function exposed to components
    const updateProfile = (name: string, avatarUrl: string) => {
        const newProfile = { name, avatarUrl };
        setProfile(newProfile);
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(newProfile));
    };

    return (
        <UserProfileContext.Provider value={{ profile, updateProfile }}>
            {children}
        </UserProfileContext.Provider>
    );
}

// Custom hook to use the context
export function useUserProfile() {
    const context = useContext(UserProfileContext);
    if (!context) {
        throw new Error('useUserProfile must be used within a UserProfileProvider');
    }
    return context;
}
