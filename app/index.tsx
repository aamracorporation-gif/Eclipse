import {Redirect} from 'expo-router';
import {useAuth} from '@/lib/AuthContext';
import {useWorkspace} from '@/lib/WorkspaceContext';
import {DiscoLoader} from '@/components/ui/DiscoLoader';
import {pathFor} from '@/src/domain/navigation';
export default function Index(){const {user,loading}=useAuth();const {space,ready}=useWorkspace();if(loading||!ready)return <DiscoLoader fullScreen label="Preparando RONDIQO"/>;return <Redirect href={(user?pathFor(space,space==='organizer'?'dashboard':'home'):'/welcome') as any}/>;}
