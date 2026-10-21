import {useLocalSearchParams} from 'expo-router';
import SportsApp from '@/src/ui/SportsApp';
export default function OrganizerPage(){const {section}=useLocalSearchParams<{section:string}>();return <SportsApp space="organizer" section={section}/>;}
