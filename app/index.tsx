import {Redirect} from 'expo-router';
import {useAuth} from '@/lib/AuthContext';
import {DiscoLoader} from '@/components/ui/DiscoLoader';
import {pathFor} from '@/src/domain/navigation';
export default function Index(){const {user,loading,isOrganizer,isAdmin}=useAuth();if(loading)return <DiscoLoader fullScreen label="Preparando tu próxima ronda"/>;return <Redirect href={(user?pathFor(isOrganizer||isAdmin?'organizer':'player',isOrganizer||isAdmin?'dashboard':'discover'):'/welcome') as any}/>;}
